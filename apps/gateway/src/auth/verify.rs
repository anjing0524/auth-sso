//! JWT 密码学验签 + jti 黑名单检查。
//!
//! [`JwtVerifier`] 仅持有 `Arc<JwksCache>`，不含 HTTP 客户端或 Redis 连接池
//! （Redis 操作通过 [`crate::redis`] 模块函数完成）。

use std::sync::Arc;

use jsonwebtoken::{decode, decode_header};
use tracing::{debug, warn};

use super::Claims;
use crate::jwks::JwksCache;

use super::{TokenExpiry, TokenStatus, VerifiedToken};

/// Access Token 剩余有效期低于此阈值（秒）时触发静默续签
const REFRESH_THRESHOLD_SEC: u64 = 300;

/// Access Token 的 typ protected header 期望值（RFC 8725 §3.11 显式类型，
/// 与 Portal contracts `JWT_TYP.ACCESS_TOKEN` 对齐）
const JWT_TYP_ACCESS: &str = "at+jwt";

/// exp 判定的时钟偏差容忍（秒）——对齐 jsonwebtoken 内置校验的默认 leeway，
/// Portal 与 Gateway 时钟偏差在此范围内不影响到期判定
const JWT_EXP_LEEWAY_SECS: u64 = 60;

/// JWT 验签失败的强类型错误。
///
/// [`JwtVerifier::verify`] 将每一种失败路径建模为独立的枚举变体，
/// 使错误成为一等公民：可被调用方区分、可被测试断言、可在日志中以
/// 结构化形式输出。替代原先把所有失败坍缩成 `None`、原因仅存于日志的反范式。
#[derive(Debug, thiserror::Error)]
pub enum VerifyError {
    /// JWT 头部解析失败（格式非法或 Base64 解码失败）。
    #[error("JWT 头部解析失败: {0}")]
    InvalidHeader(#[from] jsonwebtoken::errors::Error),
    /// JWT 头部未包含 `kid`，无法在 JWKS 缓存中定位公钥。
    #[error("JWT 头部未包含 kid")]
    MissingKid,
    /// JWKS 缓存中不存在该 `kid` 对应的公钥（可能是密钥已轮换或缓存未就绪）。
    #[error("JWKS 缓存中未找到对应的 kid: {0}")]
    UnknownKid(String),
    /// JWT 验签或 issuer/algorithm 校验未通过。
    ///
    /// 注意：头部解析失败也产生 [`jsonwebtoken::errors::Error`]，但归入
    /// [`InvalidHeader`](Self::InvalidHeader)；此处仅指签名/载荷校验阶段失败。
    #[error("JWT 验签/校验失败: {0}")]
    InvalidToken(#[source] jsonwebtoken::errors::Error),
    /// JWT 的 `jti` 已被吊销（命中 Redis 黑名单）。
    #[error("jti 已被吊销: {0}")]
    RevokedJti(String),
    /// JWT 的 `typ` 与预期用途不符（RFC 8725 §3.11 显式类型，防跨用途类型混淆）。
    #[error("JWT typ 与预期用途不符: {0}")]
    InvalidTokenType(String),
    /// JWT 头部缺少 `typ`（RFC 8725 §3.11 显式类型为强制项，ADR-013 决策 2 收紧）。
    #[error("JWT 缺少 typ header")]
    MissingTyp,
    /// 系统时钟异常（当前时间早于 Unix epoch）。
    #[error("系统时钟异常")]
    ClockError,
}

/// JWT 离线密码学验签器。
///
/// 依赖 JWKS 缓存获取公钥，Redis 不可用时 jti 黑名单 fail-close（拒绝请求）。
#[derive(Debug)]
pub struct JwtVerifier {
    jwks_cache: Arc<JwksCache>,
    check_revocation: bool,
}

impl JwtVerifier {
    pub fn new(jwks_cache: Arc<JwksCache>) -> Self {
        Self {
            jwks_cache,
            check_revocation: true,
        }
    }

    /// 仅供密码学单测使用：隔离 Redis 的 fail-close 行为，验证签名、issuer 与过期判定。
    #[cfg(test)]
    pub(crate) fn new_without_revocation_for_test(jwks_cache: Arc<JwksCache>) -> Self {
        Self {
            jwks_cache,
            check_revocation: false,
        }
    }

    /// 对 JWT Token 进行离线密码学验签 + jti 黑名单检查。
    ///
    /// 流程：解析 JWT 头部获取 kid → 从 JWKS 缓存查找公钥 → 验签 + issuer 校验
    /// → jti 黑名单检查 → 判定过期状态。
    ///
    /// Redis 不可用时 jti 黑名单检查 fail-close（拒绝请求）。
    ///
    /// # Errors
    ///
    /// 返回 [`VerifyError`] 以精确表达失败原因：
    /// - [`InvalidHeader`](VerifyError::InvalidHeader) — 头部解析失败
    /// - [`MissingKid`](VerifyError::MissingKid) — 头部缺少 kid
    /// - [`UnknownKid`](VerifyError::UnknownKid) — JWKS 中无此 kid
    /// - [`InvalidToken`](VerifyError::InvalidToken) — 验签/校验未通过
    /// - [`RevokedJti`](VerifyError::RevokedJti) — jti 已吊销
    /// - [`InvalidTokenType`](VerifyError::InvalidTokenType) / [`MissingTyp`](VerifyError::MissingTyp) — typ 校验未通过
    ///
    /// # Examples
    ///
    /// ```ignore
    /// # use std::sync::Arc;
    /// # use gateway::jwks::JwksCache;
    /// # use gateway::auth::JwtVerifier;
    /// let cache = Arc::new(JwksCache::new());
    /// let verifier = JwtVerifier::new(cache);
    /// // 无效 token 返回 Err
    /// assert!(verifier.verify("invalid").await.is_err());
    /// ```
    pub async fn verify(&self, token: &str) -> Result<TokenStatus, VerifyError> {
        // 1. 解析头部，定位 kid
        let header = decode_header(token)?;
        let kid = header.kid.ok_or(VerifyError::MissingKid)?;

        // 1b. typ 显式类型校验（RFC 8725 §3.11）：必须存在且为 at+jwt。
        // ADR-013 决策 2 收紧为强制存在——系统无生产存量 token，F11 的
        // "缺失放行"兼容窗不再开启（Portal 签发端已同步携带 typ）。
        match header.typ.as_deref() {
            Some(JWT_TYP_ACCESS) => {}
            Some(typ) => return Err(VerifyError::InvalidTokenType(typ.to_string())),
            None => return Err(VerifyError::MissingTyp),
        }

        // 2. 单次 wait-free 快照：一次原子 load 同时获得 keys + validation，零拷贝
        let meta = self.jwks_cache.snapshot();
        let now = crate::http::unix_secs().ok_or(VerifyError::ClockError)?;
        let key = meta
            .keys
            .get(&kid)
            // 宽限期外的条目视为不存在（上游轮换维护窗口的残缺响应防护）
            .filter(|entry| now.saturating_sub(entry.cached_at) < crate::jwks::JWKS_KEY_GRACE_SECS)
            .map(|entry| &entry.key)
            .ok_or_else(|| {
                // Portal 可能刚完成密钥轮换：触发一次有节流的按需刷新
                // （单飞 + 最小间隔），本次请求仍按 UnknownKid 拒绝，下一请求受益。
                if self
                    .jwks_cache
                    .request_refresh_if_due(crate::jwks::JWKS_ON_DEMAND_MIN_INTERVAL_SECS)
                {
                    warn!("UnknownKid({kid}) 已触发按需 JWKS 刷新");
                }
                VerifyError::UnknownKid(kid.clone())
            })?;

        // 3. 验签 + issuer/algorithm 校验
        let token_data = decode::<Claims>(token, key, &meta.validation).map_err(|e| {
            warn!("JWT 验签/校验失败: {:?}", e);
            VerifyError::InvalidToken(e)
        })?;
        debug!("JWT 验签通过: sub={}, kid={}", token_data.claims.sub, kid);

        // 4. jti 黑名单检查（fail-close：Redis 不可用时假定已撤销，拒绝请求）
        if self.check_revocation && self.check_jti(&token_data.claims.jti).await {
            warn!(
                "⚠️ 拒绝访问：JWT 的 jti 已被吊销: jti={}",
                token_data.claims.jti
            );
            crate::metrics::inc_jti_revoked();
            return Err(VerifyError::RevokedJti(token_data.claims.jti.clone()));
        }

        // 5. 判定过期状态（leeway 容忍 Portal/Gateway 时钟偏差；
        //    saturating_add 防 exp 极大值溢出）
        let now = crate::http::unix_secs().ok_or(VerifyError::ClockError)?;

        let expiry = if token_data.claims.exp.saturating_add(JWT_EXP_LEEWAY_SECS) < now {
            TokenExpiry::Expired
        } else if token_data.claims.exp.saturating_sub(now) < REFRESH_THRESHOLD_SEC {
            TokenExpiry::NearlyExpired
        } else {
            TokenExpiry::Valid
        };

        Ok(TokenStatus {
            token: VerifiedToken {
                user_id: token_data.claims.sub,
                jti: token_data.claims.jti,
            },
            expiry,
        })
    }

    /// 检查 jti 是否在黑名单中（fail-close：Redis 不可用时返回 true 拒绝请求）
    async fn check_jti(&self, jti: &str) -> bool {
        let jti_key = format!("portal:jti_blocklist:{}", jti);
        crate::redis::exists(&jti_key).await
    }
}
