//! 认证域：JWT 验签、Token 续签、类型定义。
//!
//! # 模块结构
//! - [`verify`] — [`JwtVerifier`]：JWT 密码学验签 + jti 黑名单
//! - [`refresh`] — [`TokenRefresher`]：HTTP 静默续签 + Redis 去重

pub mod refresh;
pub mod verify;

pub use refresh::TokenRefresher;
pub use verify::{JwtVerifier, VerifyError};

use base64::Engine;
use serde::{Deserialize, Serialize};

/// `authenticate::check` 的认证决策返回值，三态枚举替代旧 `Result<bool>` 的 boolean blindness。
///
/// 编译器强制穷尽匹配 — 新增变体时所有 `match` 分支自动报错，消除运行时漏判风险。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthDecision {
    /// 认证通过，继续代理请求
    Pass,
    /// 已向客户端发送响应（如 401），上游请求不再转发
    Interrupted,
    /// 无 JWT 的 HTML 页面导航，需生成 PKCE → 302 /authorize
    PkceRequired,
}

// ── JWT Claims ──

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Claims {
    pub sub: String,
    pub iss: String,
    pub aud: String,
    pub exp: u64,
    pub jti: String,
}

// ── Token 生命周期常量（必须与 Portal 签发端对齐）──

/// Access Token 的 Cookie Max-Age（秒）— 与 Portal `signAccessToken` 过期时间同步。
///
/// 用于网关 `response_filter` 下发续签后的新 AT。修改时务必同步 Portal 侧。
pub const ACCESS_TOKEN_MAX_AGE_SEC: u64 = 3600;

/// Refresh Token 的 Cookie Max-Age（秒）— 与 Portal `signRefreshToken` 过期时间同步。
///
/// 用于网关 `response_filter` 下发续签后的新 RT。修改时务必同步 Portal 侧。
pub const REFRESH_TOKEN_MAX_AGE_SEC: u64 = 604800;

// ── 共享类型 ──

/// JWT 验签成功后的身份信息
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedToken {
    pub user_id: String,
    pub jti: String,
}

/// Token 有效期状态
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TokenExpiry {
    /// 完全有效，无需续签
    Valid,
    /// 即将过期（< 5min），应触发静默续签但不阻断请求
    NearlyExpired,
    /// 已过期，续签失败则拒绝
    Expired,
}

/// 验签结果：身份信息 + 有效期状态（数据和判别分离，无需 into_verified 两步消费）
#[derive(Debug, Clone)]
pub struct TokenStatus {
    pub token: VerifiedToken,
    pub expiry: TokenExpiry,
}

/// 静默续签得到的新 Token 对
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefreshedTokens {
    pub access: String,
    pub refresh: String,
}

// ── 工具函数 ──

/// 从 JWT token 中提取 payload 段并 base64url 解码，返回原始字节。
///
/// 按 `.` 分割取中段，校验恰好三段格式。不进行任何密码学验证。
pub(crate) fn jwt_payload_bytes(token: &str) -> Option<Vec<u8>> {
    let mut segments = token.split('.');
    let payload = match (
        segments.next(),
        segments.next(),
        segments.next(),
        segments.next(),
    ) {
        (Some(_), Some(payload), Some(_), None) => payload,
        _ => return None,
    };
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()
}

/// 裸解 JWT payload（不验签），从 Base64 编码的 payload 段提取 Claims。
///
/// ⚠️ 不进行任何密码学验证，不可用于安全决策。
///
/// # Examples
///
/// ```
/// # use gateway::auth::decode_jwt_payload;
/// // 格式错误的 token 返回 None
/// assert!(decode_jwt_payload("not.a.jwt").is_none());
/// ```
pub fn decode_jwt_payload(token: &str) -> Option<Claims> {
    let payload_bytes = jwt_payload_bytes(token)?;
    serde_json::from_slice::<Claims>(&payload_bytes).ok()
}

#[cfg(test)]
mod tests;
