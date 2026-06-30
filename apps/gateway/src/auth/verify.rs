//! JWT 密码学验签 + jti 黑名单检查。
//!
//! [`JwtVerifier`] 仅持有 `Arc<JwksCache>`，不含 HTTP 客户端或 Redis 连接池
//! （Redis 操作通过 [`crate::redis`] 模块函数完成）。

use std::sync::Arc;

use jsonwebtoken::{decode, decode_header};
use tracing::{debug, error, warn};

use super::Claims;
use crate::jwks::JwksCache;

use super::{TokenExpiry, TokenStatus, VerifiedToken};

/// Access Token 剩余有效期低于此阈值（秒）时触发静默续签
const REFRESH_THRESHOLD_SEC: i64 = 300;

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
    pub async fn verify(&self, token: &str) -> Option<TokenStatus> {
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

        let decoding_key = match self.jwks_cache.key(&kid) {
            Some(k) => k,
            None => {
                error!("JWKS 缓存中未找到对应的 kid: {}", kid);
                return None;
            }
        };

        let validation = self.jwks_cache.validation();

        match decode::<Claims>(token, &decoding_key, &validation) {
            Ok(token_data) => {
                debug!("JWT 验签通过: sub={}, kid={}", token_data.claims.sub, kid);

                if !self.check_jti(&token_data.claims.jti).await {
                    return None;
                }

                let token = VerifiedToken {
                    user_id: token_data.claims.sub,
                    jti: token_data.claims.jti,
                };

                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as usize;

                let expiry = if token_data.claims.exp < now {
                    TokenExpiry::Expired
                } else if token_data.claims.exp.saturating_sub(now) < REFRESH_THRESHOLD_SEC as usize
                {
                    TokenExpiry::NearlyExpired
                } else {
                    TokenExpiry::Valid
                };

                Some(TokenStatus { token, expiry })
            }
            Err(e) => {
                warn!("JWT 载荷校验失败: {:?}", e);
                None
            }
        }
    }

    /// 检查 jti 是否在黑名单中（已吊销），Redis 不可用时 fail-open 放行
    async fn check_jti(&self, jti: &str) -> bool {
        let jti_key = format!("portal:jti_blocklist:{}", jti);
        if crate::redis::exists(&jti_key).await {
            warn!("⚠️ 拒绝访问：JWT 的 jti 已被吊销: jti={}", jti);
            crate::metrics::inc_jti_revoked();
            false
        } else {
            true
        }
    }
}
