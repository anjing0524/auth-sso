use std::sync::Arc;

use base64::Engine;
use jsonwebtoken::{Algorithm, Validation, decode, decode_header};
use tracing::{debug, error, info, warn};

use crate::claims::Claims;
use crate::cookie;
use crate::jwks::HTTP_CLIENT;
use crate::jwks::JwksCache;
use crate::redis::RedisPool;

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
/// issuer 和 refresh_endpoint 从 JWKS 缓存（OIDC Discovery 元数据）动态获取，
/// 不在构造时固化，避免阻塞启动。首次 JWKS 拉取未完成时使用合理默认值。
pub struct AuthService {
    jwks_cache: Arc<JwksCache>,
    /// Portal 上游地址，用于构造 refresh_endpoint 回退 URL
    upstream: String,
    redis_pool: Option<RedisPool>,
}

impl AuthService {
    pub fn new(
        jwks_cache: Arc<JwksCache>,
        upstream: String,
        redis_pool: Option<RedisPool>,
    ) -> Self {
        Self {
            jwks_cache,
            upstream,
            redis_pool,
        }
    }

    /// issuer：优先从 OIDC Discovery 缓存读取，未就绪时回退默认值
    fn issuer(&self) -> String {
        self.jwks_cache.get_discovered_issuer().unwrap_or_else(|| {
            warn!("⚠️ OIDC 元数据未就绪，使用默认 issuer");
            "http://localhost:4100".to_string()
        })
    }

    /// 续签端点 URL：优先从 OIDC Discovery 缓存读取，未就绪时回退默认路径
    fn refresh_endpoint(&self) -> String {
        self.jwks_cache
            .get_refresh_endpoint()
            .and_then(|ep| JwksCache::resolve_jwks_url(&self.upstream, &ep).ok())
            .unwrap_or_else(|| format!("http://{}/api/auth/refresh", self.upstream))
    }

    /// 对 JWT Token 进行离线密码学验签（ES256 等 OIDC Discovery 返回的算法）
    ///
    /// 流程：解析 JWT 头部获取 kid → 从 JWKS 缓存查找公钥 → 验签 + issuer 校验 → jti 黑名单检查
    ///
    /// 返回 `VerifiedToken` 表示验签通过，`None` 表示任一环节失败。
    /// Redis 不可用时 jti 黑名单检查 fail-open（放行），通过 tracing 记录降级事件。
    pub async fn verify_jwt(&self, token: &str) -> Option<VerifiedToken> {
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

        let mut validation = Validation::new(Algorithm::ES256);
        validation.set_issuer(&[&self.issuer()]);
        validation.validate_aud = false; // Gateway 仅校验签名与 issuer，aud 由 Portal 自行校验

        // 通过 OIDC Discovery 动态获取支持的签名算法
        let discovered_algorithms = self.jwks_cache.get_supported_algorithms();
        if !discovered_algorithms.is_empty() {
            validation.algorithms = discovered_algorithms;
            debug!(
                "JWT 验签使用 OIDC Discovery 算法: {:?}",
                validation.algorithms
            );
        } else {
            warn!("⚠️  OIDC 元数据未就绪，回退至默认算法 ES256");
        }

        match decode::<Claims>(token, &decoding_key, &validation) {
            Ok(token_data) => {
                debug!("JWT 验签通过: sub={}, kid={}", token_data.claims.sub, kid);

                // jti 黑名单检查（Redis 不可用时 fail-open 放行）
                if !self.check_jti_not_revoked(&token_data.claims.jti).await {
                    return None;
                }

                Some(VerifiedToken {
                    user_id: token_data.claims.sub,
                    jti: token_data.claims.jti,
                })
            }
            Err(e) => {
                warn!("JWT 载荷校验失败: {:?}", e);
                None
            }
        }
    }

    /// 检查 jti 是否在黑名单中（已吊销），失败时 fail-open 放行
    async fn check_jti_not_revoked(&self, jti: &str) -> bool {
        let pool = match self.redis_pool.as_ref() {
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
    /// 上行: Gateway → Portal  POST <refresh_endpoint>
    /// 下行: Portal → Gateway  Set-Cookie 含新 AT + RT
    ///
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

        // 2. 向 Portal 发起续签请求
        let endpoint = self.refresh_endpoint();
        debug!("发起静默续签: url={}, sub={}", endpoint, sub);
        let response = HTTP_CLIENT
            .post(&endpoint)
            .header("Cookie", format!("portal_refresh_token={}", refresh_token))
            .send()
            .await;

        match response {
            Ok(resp) if resp.status().is_success() => {
                // 3. 解析响应 Set-Cookie 头，提取新 AT / RT
                let mut new_at = None;
                let mut new_rt = None;

                for header_value in resp.headers().get_all("set-cookie").iter() {
                    if let Ok(cookie_str) = header_value.to_str() {
                        if let Some(val) =
                            cookie::extract_from_set_cookie(cookie_str, "portal_jwt_token")
                        {
                            new_at = Some(val.to_string());
                        }
                        if let Some(val) =
                            cookie::extract_from_set_cookie(cookie_str, "portal_refresh_token")
                        {
                            new_rt = Some(val.to_string());
                        }
                    }
                }

                match (new_at, new_rt) {
                    (Some(access), Some(refresh)) => {
                        info!("静默续签成功: sub={}", sub);
                        let tokens = RefreshedTokens { access, refresh };
                        self.set_refresh_dedup(sub, &tokens).await;
                        Some(tokens)
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

    /// 通过 Redis 检查续签去重缓存（30s 窗口内同用户复用结果）
    async fn check_refresh_dedup(&self, sub: &str) -> Option<RefreshedTokens> {
        let pool = self.redis_pool.as_ref()?;
        let mut conn = pool.get().await.ok()?;
        let key = format!("{}{}", REFRESH_DEDUP_PREFIX, sub);
        let cached: Option<String> = redis::cmd("GET")
            .arg(&key)
            .query_async(&mut *conn)
            .await
            .ok()?;
        cached.and_then(|v| {
            let (access, refresh) = v.split_once('|')?;
            Some(RefreshedTokens {
                access: access.to_string(),
                refresh: refresh.to_string(),
            })
        })
    }

    /// 向 Redis 写入续签去重缓存（SET NX EX，原子去重 + 自动过期）
    async fn set_refresh_dedup(&self, sub: &str, tokens: &RefreshedTokens) {
        if let Some(ref pool) = self.redis_pool
            && let Ok(mut conn) = pool.get().await
        {
            let key = format!("{}{}", REFRESH_DEDUP_PREFIX, sub);
            let value = format!("{}|{}", tokens.access, tokens.refresh);
            let _: Result<(), _> = redis::cmd("SET")
                .arg(&key)
                .arg(&value)
                .arg("NX")
                .arg("EX")
                .arg(REFRESH_DEDUP_SEC as i64)
                .query_async(&mut *conn)
                .await;
        }
    }
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

/// 判断 Access Token 是否即将过期（剩余有效期 < REFRESH_THRESHOLD_SEC）
pub fn needs_refresh(token: &str) -> bool {
    let now_sec = std::time::SystemTime::now()
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    decode_jwt_payload(token)
        .map(|claims| claims.exp as i64 - now_sec < REFRESH_THRESHOLD_SEC)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{DecodingKey, EncodingKey, Header, encode};

    use crate::jwks::OidcMetadata;

    fn make_test_auth_service(jwks_cache: &Arc<JwksCache>) -> AuthService {
        AuthService::new(Arc::clone(jwks_cache), "127.0.0.1:4100".to_string(), None)
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

        jwks_cache.set_metadata_for_test(OidcMetadata {
            issuer: Some(issuer.to_string()),
            jwks_uri: Some("https://sso.example.com/api/auth/jwks".into()),
            id_token_signing_alg_values_supported: vec!["HS256".into()],
            refresh_endpoint: None,
        });

        let secret = b"super-secret-key-that-is-long-enough-for-hs256";
        let kid = "key-test-1";
        jwks_cache.insert_key_for_test(kid.to_string(), DecodingKey::from_secret(secret));

        let auth_service = make_test_auth_service(&jwks_cache);
        let token = make_test_token(kid, secret, issuer, "user-123", "jti-123", 3600);

        let result = auth_service.verify_jwt(&token).await;
        assert!(result.is_some());
        let verified = result.unwrap();
        assert_eq!(verified.user_id, "user-123");
        assert_eq!(verified.jti, "jti-123");
    }

    #[tokio::test]
    async fn test_verify_jwt_expired() {
        let jwks_cache = Arc::new(JwksCache::new());
        let issuer = "https://sso.example.com";

        jwks_cache.set_metadata_for_test(OidcMetadata {
            issuer: Some(issuer.to_string()),
            jwks_uri: Some("https://sso.example.com/api/auth/jwks".into()),
            id_token_signing_alg_values_supported: vec!["HS256".into()],
            refresh_endpoint: None,
        });

        let secret = b"super-secret-key-that-is-long-enough-for-hs256";
        let kid = "key-test-1";
        jwks_cache.insert_key_for_test(kid.to_string(), DecodingKey::from_secret(secret));

        let auth_service = make_test_auth_service(&jwks_cache);
        let token = make_test_token(kid, secret, issuer, "user-123", "jti-123", -600);

        let result = auth_service.verify_jwt(&token).await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_verify_jwt_invalid_issuer() {
        let jwks_cache = Arc::new(JwksCache::new());
        let issuer = "https://sso.example.com";

        jwks_cache.set_metadata_for_test(OidcMetadata {
            issuer: Some(issuer.to_string()),
            jwks_uri: Some("https://sso.example.com/api/auth/jwks".into()),
            id_token_signing_alg_values_supported: vec!["HS256".into()],
            refresh_endpoint: None,
        });

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

        jwks_cache.set_metadata_for_test(OidcMetadata {
            issuer: Some(issuer.to_string()),
            jwks_uri: Some("https://sso.example.com/api/auth/jwks".into()),
            id_token_signing_alg_values_supported: vec!["HS256".into()],
            refresh_endpoint: None,
        });

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

    #[test]
    fn test_needs_refresh() {
        let secret = b"sufficiently-long-secret-key-for-hs256!!";
        let now = std::time::SystemTime::now()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs() as usize;

        // 即将过期的 token（60 秒后）
        let claims_near_expiry = Claims {
            sub: "user-1".to_string(),
            iss: "test".to_string(),
            aud: "test".to_string(),
            exp: now + 60,
            jti: "jti-1".to_string(),
            roles: vec![],
            permissions: vec![],
            dept_ids: vec![],
        };
        let token_near = encode(
            &Header::new(Algorithm::HS256),
            &claims_near_expiry,
            &EncodingKey::from_secret(secret),
        )
        .unwrap();
        assert!(needs_refresh(&token_near));

        // 长期有效的 token（1 小时后）
        let claims_far = Claims {
            sub: "user-1".to_string(),
            iss: "test".to_string(),
            aud: "test".to_string(),
            exp: now + 3600,
            jti: "jti-1".to_string(),
            roles: vec![],
            permissions: vec![],
            dept_ids: vec![],
        };
        let token_far = encode(
            &Header::new(Algorithm::HS256),
            &claims_far,
            &EncodingKey::from_secret(secret),
        )
        .unwrap();
        assert!(!needs_refresh(&token_far));
    }
}
