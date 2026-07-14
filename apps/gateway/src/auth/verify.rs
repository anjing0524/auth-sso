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
}

/// JWT 离线密码学验签器。
///
/// 依赖 JWKS 缓存获取公钥，Redis 不可用时 jti 黑名单 fail-open。
#[derive(Debug)]
pub struct JwtVerifier {
    jwks_cache: Arc<JwksCache>,
}

impl JwtVerifier {
    pub fn new(jwks_cache: Arc<JwksCache>) -> Self {
        Self { jwks_cache }
    }

    /// 对 JWT Token 进行离线密码学验签 + jti 黑名单检查。
    ///
    /// 流程：解析 JWT 头部获取 kid → 从 JWKS 缓存查找公钥 → 验签 + issuer 校验
    /// → jti 黑名单检查 → 判定过期状态。
    ///
    /// Redis 不可用时 jti 黑名单检查 fail-open（放行）。
    ///
    /// # Errors
    ///
    /// 返回 [`VerifyError`] 以精确表达失败原因：
    /// - [`InvalidHeader`](VerifyError::InvalidHeader) — 头部解析失败
    /// - [`MissingKid`](VerifyError::MissingKid) — 头部缺少 kid
    /// - [`UnknownKid`](VerifyError::UnknownKid) — JWKS 中无此 kid
    /// - [`InvalidToken`](VerifyError::InvalidToken) — 验签/校验未通过
    /// - [`RevokedJti`](VerifyError::RevokedJti) — jti 已吊销
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

        // 2. 从 JWKS 缓存查找公钥
        let decoding_key = self
            .jwks_cache
            .key(&kid)
            .ok_or_else(|| VerifyError::UnknownKid(kid.clone()))?;

        // 3. 验签 + issuer/algorithm 校验
        let validation = self.jwks_cache.validation();
        let token_data = decode::<Claims>(token, &decoding_key, &validation).map_err(|e| {
            warn!("JWT 验签/校验失败: {:?}", e);
            VerifyError::InvalidToken(e)
        })?;
        debug!("JWT 验签通过: sub={}, kid={}", token_data.claims.sub, kid);

        // 4. jti 黑名单检查（fail-open：Redis 不可用时放行）
        if self.check_jti(&token_data.claims.jti).await {
            warn!(
                "⚠️ 拒绝访问：JWT 的 jti 已被吊销: jti={}",
                token_data.claims.jti
            );
            crate::metrics::inc_jti_revoked();
            return Err(VerifyError::RevokedJti(token_data.claims.jti.clone()));
        }

        // 5. 判定过期状态
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("系统时钟异常：当前时间早于 Unix epoch")
            .as_secs();

        let expiry = if token_data.claims.exp < now {
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

    /// 检查 jti 是否在黑名单中（fail-open：Redis 不可用时返回 false 放行请求）
    async fn check_jti(&self, jti: &str) -> bool {
        let jti_key = format!("portal:jti_blocklist:{}", jti);
        crate::redis::exists(&jti_key).await
    }
}
