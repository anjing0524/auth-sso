//! 认证域：JWT 验签、Token 续签、类型定义。
//!
//! # 模块结构
//! - [`verify`] — [`JwtVerifier`]：JWT 密码学验签 + jti 黑名单
//! - [`refresh`] — [`TokenRefresher`]：HTTP 静默续签 + Redis 去重

pub mod refresh;
pub mod verify;

pub use refresh::TokenRefresher;
pub use verify::JwtVerifier;

use base64::Engine;
use serde::{Deserialize, Serialize};

// ── JWT Claims ──

/// JWT 载荷完整声明（Portal signAccessToken 签发时总是包含全部字段）。
/// v3.2: dept_id + data_scope_type 替换为 dept_ids (string[])
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Claims {
    pub sub: String,
    pub iss: String,
    pub aud: String,
    pub exp: usize,
    pub jti: String,
    pub roles: Vec<String>,
    pub permissions: Vec<String>,
    /// 用户所有角色所属部门（含子树展开）的 ID 列表
    pub dept_ids: Vec<String>,
}

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
mod tests;
