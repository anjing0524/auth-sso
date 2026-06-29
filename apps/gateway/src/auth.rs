use std::sync::Arc;

use base64::Engine;
use jsonwebtoken::{decode, decode_header};
use tracing::{debug, error, info, warn};

use crate::claims::Claims;
use crate::cookie;
use crate::http::HTTP_CLIENT;
use crate::jwks::JwksCache;

/// Access Token 剩余有效期低于此阈值（秒）时触发静默续签
pub const REFRESH_THRESHOLD_SEC: i64 = 300;

/// 同用户续签去重窗口（秒），防止并发请求反复轮换 Refresh Token
const REFRESH_DEDUP_SEC: u64 = 30;

/// Redis 续签去重 key 前缀
const REFRESH_DEDUP_PREFIX: &str = "portal:refresh_dedup:";

/// JWT 验签成功后的身份信息
#[derive(Debug)]
pub struct VerifiedToken {
    /// 用户 ID（JWT sub claim）
    pub user_id: String,
    /// JWT 唯一标识（jti claim），用于微服务端拉黑校验
    pub jti: String,
}

/// JWT 验签与过期状态
#[derive(Debug)]
pub enum VerifyResult {
    /// 签名有效且未过期
    Valid(VerifiedToken),
    /// 签名有效，即将过期（触发静默续签窗口）
    NeedsRefresh(VerifiedToken),
    /// 签名有效，但已完全过期（必须强制通过 Refresh Token 续签，否则 401）
    Expired(VerifiedToken),
}

impl VerifyResult {
    /// 借用内部已验签的身份信息（三种状态携带同一份 `VerifiedToken`）
    pub fn verified(&self) -> &VerifiedToken {
        match self {
            VerifyResult::Valid(v) | VerifyResult::NeedsRefresh(v) | VerifyResult::Expired(v) => v,
        }
    }
}

/// 静默续签得到的新 Token 对
#[derive(Debug, Clone)]
pub struct RefreshedTokens {
    /// 新的 Access Token
    pub access: String,
    /// 新的 Refresh Token
    pub refresh: String,
}

/// 认证服务：封装 JWT 验签、jti 黑名单检查、Token 静默续签
///
/// issuer 与 refresh_endpoint 从 JWKS 缓存（OIDC Discovery 元数据）动态获取，
/// 不在构造时固化，避免阻塞启动。issuer 仅在元数据就绪后参与校验；
/// refresh_endpoint 未就绪时回退到首个 upstream 的 `/api/auth/refresh`。
pub struct AuthService {
    jwks_cache: Arc<JwksCache>,
    /// Portal 上游地址列表，用于构造 refresh_endpoint 回退 URL（取首个）
    upstreams: Vec<String>,
}

impl AuthService {
    pub fn new(jwks_cache: Arc<JwksCache>, upstreams: Vec<String>) -> Self {
        Self {
            jwks_cache,
            upstreams,
        }
    }

    /// 续签端点 URL：优先使用 OIDC Discovery 缓存中预拼装好的 URL，
    /// 未就绪时返回 None（调用方应遍历 upstream 逐一尝试默认路径）
    fn refresh_endpoint(&self) -> Option<Arc<str>> {
        self.jwks_cache.get_refresh_endpoint()
    }

    /// 向指定续签端点发起一次 POST 请求，解析响应 Set-Cookie 提取新 Token 对
    async fn try_refresh_at_endpoint(
        &self,
        endpoint: &str,
        refresh_token: &str,
        sub: &str,
    ) -> Option<RefreshedTokens> {
        debug!("发起静默续签: url={}, sub={}", endpoint, sub);
        let response = HTTP_CLIENT
            .post(endpoint)
            .header(
                "Cookie",
                format!("{}={}", cookie::REFRESH_COOKIE, refresh_token),
            )
            .send()
            .await;

        match response {
            Ok(resp) if resp.status().is_success() => {
                let mut new_at = None;
                let mut new_rt = None;

                for header_value in resp.headers().get_all("set-cookie").iter() {
                    if let Ok(cookie_str) = header_value.to_str() {
                        if let Some(val) =
                            cookie::extract_from_set_cookie(cookie_str, cookie::ACCESS_COOKIE)
                        {
                            new_at = Some(val.to_string());
                        }
                        if let Some(val) =
                            cookie::extract_from_set_cookie(cookie_str, cookie::REFRESH_COOKIE)
                        {
                            new_rt = Some(val.to_string());
                        }
                    }
                }

                match (new_at, new_rt) {
                    (Some(access), Some(refresh)) => {
                        info!("静默续签成功: sub={}", sub);
                        Some(RefreshedTokens { access, refresh })
                    }
                    _ => {
                        warn!("续签响应缺少预期的 Set-Cookie 头: sub={}", sub);
                        None
                    }
                }
            }
            Ok(resp) => {
                warn!(
                    "续签请求被 Portal 拒绝: status={}, sub={}",
                    resp.status(),
                    sub
                );
                None
            }
            Err(e) => {
                warn!("续签请求网络错误: {}, sub={}", e, sub);
                None
            }
        }
    }

    /// 对 JWT Token 进行离线密码学验签（ES256 等 OIDC Discovery 返回的算法）
    ///
    /// 流程：解析 JWT 头部获取 kid → 从 JWKS 缓存查找公钥 → 验签 + issuer 校验 → jti 黑名单检查
    ///
    /// 返回 `VerifyResult` 表示验签（签名部分）通过，内部区分是否过期。
    /// Redis 不可用时 jti 黑名单检查 fail-open（放行），通过 tracing 记录降级事件。
    pub async fn verify_jwt(&self, token: &str) -> Option<VerifyResult> {
        let header = match decode_header(token) {
            Ok(h) => h,
            Err(e) => {
                warn!("JWT 头部解析失败: {:?}", e);
                return None;
            }
        };

        let kid = match header.kid {
            Some(k) => k,
            None => {
                warn!("JWT 头部未包含 kid");
                return None;
            }
        };

        let decoding_key = match self.jwks_cache.get_key(&kid) {
            Some(k) => k,
            None => {
                error!("JWKS 缓存中未找到对应的 kid: {}", kid);
                return None;
            }
        };

        // 核心性能优化：直接获取预先拼装好的 Validation 结构体，实现零动态分配与零拷贝
        let validation = self.jwks_cache.get_validation();

        match decode::<Claims>(token, &decoding_key, &validation) {
            Ok(token_data) => {
                debug!("JWT 验签通过: sub={}, kid={}", token_data.claims.sub, kid);

                // jti 黑名单检查（Redis 不可用时 fail-open 放行）
                if !self.check_jti_not_revoked(&token_data.claims.jti).await {
                    return None;
                }

                let verified = VerifiedToken {
                    user_id: token_data.claims.sub,
                    jti: token_data.claims.jti,
                };

                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as usize;

                if token_data.claims.exp < now {
                    Some(VerifyResult::Expired(verified))
                } else if token_data.claims.exp.saturating_sub(now) < REFRESH_THRESHOLD_SEC as usize
                {
                    Some(VerifyResult::NeedsRefresh(verified))
                } else {
                    Some(VerifyResult::Valid(verified))
                }
            }
            Err(e) => {
                warn!("JWT 载荷校验失败: {:?}", e);
                None
            }
        }
    }

    /// 检查 jti 是否在黑名单中（已吊销），失败时 fail-open 放行
    async fn check_jti_not_revoked(&self, jti: &str) -> bool {
        let pool = match crate::redis::get_pool() {
            Some(p) => p,
            None => return true, // 无 Redis → fail-open
        };

        let mut conn = match pool.get().await {
            Ok(c) => c,
            Err(e) => {
                error!("❌ Redis 连接池获取连接失败: {:?}，执行安全降级 (放行)", e);
                return true;
            }
        };

        let jti_key = format!("portal:jti_blocklist:{}", jti);
        match redis::cmd("EXISTS")
            .arg(&jti_key)
            .query_async::<i32>(&mut *conn)
            .await
        {
            Ok(0) => true,
            Ok(_) => {
                warn!("⚠️ 拒绝访问：JWT 的 jti 已被吊销: jti={}", jti);
                false
            }
            Err(e) => {
                error!("❌ Redis 校验 jti 黑名单异常: {:?}，执行安全降级 (放行)", e);
                true
            }
        }
    }

    /// 向 Portal 发起 Access Token 静默续签
    ///
    /// 先尝试 OIDC Discovery 缓存的主端点，失败后遍历全部 upstream 逐一回退。
    /// 通过 Redis 实现 30s 跨实例去重，避免并发请求反复轮换 Refresh Token。
    /// 返回 `Some(RefreshedTokens)` 或 `None`（续签失败不阻断请求，旧 AT 仍有效）。
    pub async fn try_refresh_token(
        &self,
        refresh_token: &str,
        sub: &str,
    ) -> Option<RefreshedTokens> {
        // 1. Redis 去重检查（30s 窗口，跨实例共享）
        if let Some(cached) = self.check_refresh_dedup(sub).await {
            debug!("续签去重命中 (Redis): sub={}", sub);
            return Some(cached);
        }

        // 2. 尝试主端点（来自 OIDC Discovery 缓存）
        if let Some(primary) = self.refresh_endpoint()
            && let Some(tokens) = self
                .try_refresh_at_endpoint(&primary, refresh_token, sub)
                .await
        {
            self.set_refresh_dedup(sub, &tokens).await;
            return Some(tokens);
        }

        // 3. 缓存未就绪或主端点失败 → 遍历全部 upstream 的默认续签路径逐一回退
        if self.upstreams.is_empty() {
            warn!(
                "无法续签: OIDC 元数据未就绪且未配置任何 upstream，放弃续签 sub={}",
                sub
            );
            return None;
        }

        for upstream in &self.upstreams {
            let fallback_url = format!("http://{}/api/auth/refresh", upstream);
            if let Some(tokens) = self
                .try_refresh_at_endpoint(&fallback_url, refresh_token, sub)
                .await
            {
                self.set_refresh_dedup(sub, &tokens).await;
                return Some(tokens);
            }
        }

        None
    }

    /// 通过 Redis 检查续签去重缓存（30s 窗口内同用户复用结果）
    async fn check_refresh_dedup(&self, sub: &str) -> Option<RefreshedTokens> {
        let mut conn = redis_conn().await?;
        let key = format!("{}{}", REFRESH_DEDUP_PREFIX, sub);
        let cached: Option<String> = match redis::cmd("GET").arg(&key).query_async(&mut *conn).await
        {
            Ok(v) => v,
            Err(e) => {
                warn!("Redis 续签去重查询失败: {:?}", e);
                return None;
            }
        };
        let cached = cached?;
        let (access, refresh) = cached.split_once('|')?;
        Some(RefreshedTokens {
            access: access.to_string(),
            refresh: refresh.to_string(),
        })
    }

    /// 向 Redis 写入续签去重缓存（SET NX EX，原子去重 + 自动过期）
    async fn set_refresh_dedup(&self, sub: &str, tokens: &RefreshedTokens) {
        if let Some(mut conn) = redis_conn().await {
            let key = format!("{}{}", REFRESH_DEDUP_PREFIX, sub);
            let value = format!("{}|{}", tokens.access, tokens.refresh);
            if let Err(e) = redis::cmd("SET")
                .arg(&key)
                .arg(&value)
                .arg("NX")
                .arg("EX")
                .arg(REFRESH_DEDUP_SEC as i64)
                .query_async::<()>(&mut *conn)
                .await
            {
                warn!("Redis 续签去重写入失败: {:?}", e);
            }
        }
    }
}

/// 获取一条 Redis 连接；连接池未就绪或取连接失败时返回 None
///
/// 续签去重路径复用此 helper；安全相关的 jti 黑名单检查因需保留独立的降级日志，
/// 仍显式处理连接获取（见 `check_jti_not_revoked`）。
async fn redis_conn() -> Option<bb8::PooledConnection<'static, bb8_redis::RedisConnectionManager>> {
    crate::redis::get_pool()
        .or_else(|| {
            warn!("Redis 连接池未就绪，续签去重降级");
            None
        })?
        .get()
        .await
        .map_err(|e| warn!("Redis 连接获取失败，续签去重降级: {:?}", e))
        .ok()
}

/// 裸解 JWT payload（不验签），从 Base64 编码的 payload 段提取 Claims
///
/// 用于续签后解码新 AT 的 sub/jti，或检查 AT 是否临近过期。
/// ⚠️ 不进行任何密码学验证，不可用于安全决策。
pub fn decode_jwt_payload(token: &str) -> Option<Claims> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let payload_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(parts[1])
        .ok()?;
    serde_json::from_slice::<Claims>(&payload_bytes).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, encode};

    fn make_test_auth_service(jwks_cache: &Arc<JwksCache>) -> AuthService {
        AuthService::new(Arc::clone(jwks_cache), vec!["127.0.0.1:4100".to_string()])
    }

    /// 生成测试用 HS256 JWT
    fn make_test_token(
        kid: &str,
        secret: &[u8],
        issuer: &str,
        sub: &str,
        jti: &str,
        exp_offset_sec: i64,
    ) -> String {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let claims = Claims {
            sub: sub.to_string(),
            iss: issuer.to_string(),
            aud: "portal-client".to_string(),
            exp: (now as i64 + exp_offset_sec) as usize,
            jti: jti.to_string(),
            roles: vec!["ADMIN".to_string()],
            permissions: vec!["user:list".to_string()],
            dept_ids: vec!["dept-1".to_string()],
        };
        let mut header = Header::new(Algorithm::HS256);
        header.kid = Some(kid.to_string());
        encode(&header, &claims, &EncodingKey::from_secret(secret)).unwrap()
    }

    #[tokio::test]
    async fn test_verify_jwt_successful() {
        let jwks_cache = Arc::new(JwksCache::new());
        let issuer = "https://sso.example.com";

        jwks_cache.set_metadata_for_test(issuer, &["HS256"]);

        let secret = b"super-secret-key-that-is-long-enough-for-hs256";
        let kid = "key-test-1";
        jwks_cache.insert_key_for_test(kid.to_string(), DecodingKey::from_secret(secret));

        let auth_service = make_test_auth_service(&jwks_cache);
        let token = make_test_token(kid, secret, issuer, "user-123", "jti-123", 3600);

        let result = auth_service.verify_jwt(&token).await;
        assert!(matches!(result, Some(VerifyResult::Valid(_))));
        if let Some(VerifyResult::Valid(v)) = result {
            assert_eq!(v.user_id, "user-123");
            assert_eq!(v.jti, "jti-123");
        }
    }

    #[tokio::test]
    async fn test_verify_jwt_expired() {
        let jwks_cache = Arc::new(JwksCache::new());
        let issuer = "https://sso.example.com";

        jwks_cache.set_metadata_for_test(issuer, &["HS256"]);

        let secret = b"super-secret-key-that-is-long-enough-for-hs256";
        let kid = "key-test-1";
        jwks_cache.insert_key_for_test(kid.to_string(), DecodingKey::from_secret(secret));

        let auth_service = make_test_auth_service(&jwks_cache);
        let token = make_test_token(kid, secret, issuer, "user-123", "jti-123", -600);

        let result = auth_service.verify_jwt(&token).await;
        assert!(matches!(result, Some(VerifyResult::Expired(_))));
    }

    #[tokio::test]
    async fn test_verify_jwt_invalid_issuer() {
        let jwks_cache = Arc::new(JwksCache::new());
        let issuer = "https://sso.example.com";

        jwks_cache.set_metadata_for_test(issuer, &["HS256"]);

        let secret = b"super-secret-key-that-is-long-enough-for-hs256";
        let kid = "key-test-1";
        jwks_cache.insert_key_for_test(kid.to_string(), DecodingKey::from_secret(secret));

        let auth_service = make_test_auth_service(&jwks_cache);
        // 使用错误的 issuer 签发 token
        let token = make_test_token(
            kid,
            secret,
            "https://hacker.com",
            "user-123",
            "jti-123",
            3600,
        );

        let result = auth_service.verify_jwt(&token).await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_verify_jwt_invalid_kid() {
        let jwks_cache = Arc::new(JwksCache::new());
        let issuer = "https://sso.example.com";

        jwks_cache.set_metadata_for_test(issuer, &["HS256"]);

        let secret = b"super-secret-key-that-is-long-enough-for-hs256";
        // 注册 key-test-1，但 token 使用 unknown-kid
        jwks_cache.insert_key_for_test("key-test-1".to_string(), DecodingKey::from_secret(secret));

        let auth_service = make_test_auth_service(&jwks_cache);
        let token = make_test_token("unknown-kid", secret, issuer, "user-123", "jti-123", 3600);

        let result = auth_service.verify_jwt(&token).await;
        assert!(result.is_none());
    }

    #[test]
    fn test_decode_jwt_payload() {
        let secret = b"sufficiently-long-secret-key-for-hs256!!";
        let claims = Claims {
            sub: "user-1".to_string(),
            iss: "test".to_string(),
            aud: "test".to_string(),
            exp: 9999999999usize,
            jti: "jti-1".to_string(),
            roles: vec!["ADMIN".to_string()],
            permissions: vec!["read".to_string()],
            dept_ids: vec!["dept-1".to_string()],
        };
        let token = encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(secret),
        )
        .unwrap();
        let decoded = decode_jwt_payload(&token).unwrap();
        assert_eq!(decoded.sub, "user-1");
        assert_eq!(decoded.exp, 9999999999usize);
        assert_eq!(decoded.jti, "jti-1");
        assert_eq!(decoded.roles, vec!["ADMIN"]);
    }

    #[test]
    fn test_decode_jwt_payload_invalid() {
        assert!(decode_jwt_payload("not.a.jwt").is_none());
        assert!(decode_jwt_payload("").is_none());
    }
}
