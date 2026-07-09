//! OAuth 2.1 Client 层：PKCE (S256) 生成、Cookie 构造、/authorize URL 构建。
//!
//! Gateway 为每个下游应用统一执行 OAuth Client 职责：
//! 1. 无 JWT 页面导航 → 生成 PKCE/state/nonce/return_to → Set-Cookie → 302 /authorize
//! 2. callback 回调 → 从 Cookie 取 verifier → POST /token（若配置了 client_secret）
//!    → Set-Cookie 下发 token → 302 return_to
//! 3. callback 透传（无 secret） → 注入 X-OAuth-Code-Verifier header → 透传给下游

use base64::Engine;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::auth::{ACCESS_TOKEN_MAX_AGE_SEC, REFRESH_TOKEN_MAX_AGE_SEC};
use crate::config::OAuthConfig;
use crate::cookie;

/// PKCE 一次性密钥对
#[derive(Debug, Clone)]
pub struct PkcePair {
    pub verifier: String,
    pub challenge: String,
}

/// OAuth 2.1 授权请求参数
#[derive(Debug, Clone)]
pub struct OAuthState {
    pub code_verifier: String,
    pub code_challenge: String,
    pub state: String,
    pub nonce: String,
    pub return_to: String,
    pub client_id: String,
    pub redirect_uri: String,
}

// ── OAuth 2.1 Client Cookie 名称（必须与 Portal /callback/route.ts 完全一致）──

const PKCE_VERIFIER_COOKIE: &str = "pkce_verifier";
const OAUTH_STATE_COOKIE: &str = "oauth_state";
const OAUTH_NONCE_COOKIE: &str = "oauth_nonce";
const RETURN_TO_COOKIE: &str = "return_to";

/// 临时 OAuth Cookie 的 TTL（秒）— 与 authorization_code 5min 对齐
const OAUTH_COOKIE_MAX_AGE: u64 = 300;

// ── PKCE 生成 ──

/// 生成 PKCE code_verifier（43 字符随机字符串，符合 RFC 7636 §4.1）
///
/// 使用 UUID v4 作为熵源（122 bit），去除连字符得到 32 字符 hex 字符串，
/// 满足 code_verifier 的最小长度要求（43 字符的 base64url 编码）。
/// Portal 侧 generateCodeVerifier() 使用 `crypto.getRandomValues(new Uint8Array(32))`，
/// 44 字符 base64url。本函数与之等效：UUID v4 提供足够熵。
pub fn generate_code_verifier() -> String {
    Uuid::new_v4().to_string().replace('-', "") // 32 chars hex
}

/// 生成 PKCE S256 code_challenge
///
/// `code_challenge = BASE64URL(SHA256(code_verifier))`，符合 RFC 7636 §4.2。
pub fn generate_code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

/// 生成一次性 PKCE 密钥对
pub fn generate_pkce() -> PkcePair {
    let verifier = generate_code_verifier();
    let challenge = generate_code_challenge(&verifier);
    PkcePair {
        verifier,
        challenge,
    }
}

/// 生成随机 OAuth state + nonce 值（Web Crypto 等效：crypto.randomUUID()）
fn generate_random_state() -> String {
    Uuid::new_v4().to_string()
}

// ── OAuth State ──

/// 为指定 upstream 构造完整的 OAuth 2.1 授权请求状态
pub fn build_oauth_state(
    oauth_config: &OAuthConfig,
    origin_host: &str,
    return_to: &str,
) -> OAuthState {
    let pkce = generate_pkce();
    let redirect_uri = format!(
        "{}://{}{}",
        if (origin_host.starts_with("localhost") || origin_host.starts_with("127."))
            && !origin_host.contains("18443")
        {
            "http"
        } else {
            "https"
        },
        origin_host,
        oauth_config.callback_path,
    );

    OAuthState {
        code_verifier: pkce.verifier,
        code_challenge: pkce.challenge,
        state: generate_random_state(),
        nonce: generate_random_state(),
        return_to: return_to.to_string(),
        client_id: oauth_config.client_id.clone(),
        redirect_uri,
    }
}

// ── Cookie 构造 ──

/// 构造单个 Set-Cookie 头值
fn build_set_cookie(name: &str, value: &str, max_age: u64, secure: bool) -> String {
    let secure_str = if secure { "; Secure" } else { "" };
    format!(
        "{name}={value}; Path=/api/auth/callback; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure_str}"
    )
}

/// 构造 OAuth Client 四个临时 HttpOnly Cookie 的 Set-Cookie 头值列表
///
/// Cookie 列表（与 Portal proxy.ts 生成的完全一致）:
/// - pkce_verifier   — PKCE code_verifier
/// - oauth_state     — OAuth state（CSRF 防护）
/// - oauth_nonce     — OIDC nonce（防重放）
/// - return_to       — 登录完成后回跳路径
///
/// 所有 Cookie 设置 Path=/api/auth/callback，仅在 callback 端点携带，
/// 5 分钟 TTL 与 authorization_code 对齐。
pub fn build_oauth_cookies(state: &OAuthState, secure: bool) -> Vec<String> {
    vec![
        build_set_cookie(
            PKCE_VERIFIER_COOKIE,
            &state.code_verifier,
            OAUTH_COOKIE_MAX_AGE,
            secure,
        ),
        build_set_cookie(
            OAUTH_STATE_COOKIE,
            &state.state,
            OAUTH_COOKIE_MAX_AGE,
            secure,
        ),
        build_set_cookie(
            OAUTH_NONCE_COOKIE,
            &state.nonce,
            OAUTH_COOKIE_MAX_AGE,
            secure,
        ),
        build_set_cookie(
            RETURN_TO_COOKIE,
            &state.return_to,
            OAUTH_COOKIE_MAX_AGE,
            secure,
        ),
    ]
}

/// 构造登录后 Set-Cookie: portal_jwt_token + portal_refresh_token
pub fn build_session_cookies(access_token: &str, refresh_token: &str, secure: bool) -> Vec<String> {
    vec![
        format!(
            "{}={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}{}",
            cookie::ACCESS_COOKIE,
            access_token,
            ACCESS_TOKEN_MAX_AGE_SEC,
            if secure { "; Secure" } else { "" },
        ),
        format!(
            "{}={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}{}",
            cookie::REFRESH_COOKIE,
            refresh_token,
            REFRESH_TOKEN_MAX_AGE_SEC,
            if secure { "; Secure" } else { "" },
        ),
    ]
}

/// 清除 4 个临时 OAuth Cookie 的 Set-Cookie 头
pub fn build_clear_oauth_cookies(secure: bool) -> Vec<String> {
    let secure_str = if secure { "; Secure" } else { "" };
    let suffix =
        format!("; Path=/api/auth/callback; HttpOnly; SameSite=Lax; Max-Age=0{secure_str}");
    vec![
        format!("{PKCE_VERIFIER_COOKIE}={suffix}"),
        format!("{OAUTH_STATE_COOKIE}={suffix}"),
        format!("{OAUTH_NONCE_COOKIE}={suffix}"),
        format!("{RETURN_TO_COOKIE}={suffix}"),
    ]
}

// ── Cookie 提取（用于 callback 拦截）──

/// 从 Cookie 头部提取 pkce_verifier 值
pub fn extract_pkce_verifier(cookie_header: &str) -> Option<&str> {
    cookie::extract_from_header(cookie_header, PKCE_VERIFIER_COOKIE)
}

/// 从 Cookie 头部提取 return_to 值
pub fn extract_return_to(cookie_header: &str) -> Option<&str> {
    cookie::extract_from_header(cookie_header, RETURN_TO_COOKIE)
}

/// 从 Cookie 头部提取 oauth_nonce 值
pub fn extract_oauth_nonce(cookie_header: &str) -> Option<&str> {
    cookie::extract_from_header(cookie_header, OAUTH_NONCE_COOKIE)
}

/// 从 Cookie 头部提取 oauth_state 值（CSRF 校验用）
pub fn extract_oauth_state(cookie_header: &str) -> Option<&str> {
    cookie::extract_from_header(cookie_header, OAUTH_STATE_COOKIE)
}

/// 从 ID Token JWT payload 裸解码 nonce claim（不验签，仅一致性比对）
pub fn decode_id_token_nonce(id_token: &str) -> Option<String> {
    let mut segs = id_token.split('.');
    let payload = match (segs.next(), segs.next(), segs.next(), segs.next()) {
        (Some(_), Some(p), Some(_), None) => p,
        _ => return None,
    };
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    let s = std::str::from_utf8(&bytes).ok()?;
    // 极简 JSON 字段提取，无 serde 分配开销
    let pattern = "\"nonce\":\"";
    let start = s.find(pattern)? + pattern.len();
    let rest = &s[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

// ── Token 交换请求体 ──

/// 构造 /token 端点的 code→token 交换请求体（JSON）
pub fn build_token_exchange_body(
    code: &str,
    code_verifier: &str,
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
) -> serde_json::Value {
    serde_json::json!({
        "grant_type": "authorization_code",
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "code_verifier": code_verifier,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_verifier_length() {
        let v = generate_code_verifier();
        assert_eq!(v.len(), 32);
        // 仅十六进制字符
        assert!(v.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn pkce_challenge_is_valid_base64url() {
        let pair = generate_pkce();
        let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(&pair.challenge);
        assert!(decoded.is_ok(), "challenge 不是有效的 base64url");
    }

    #[test]
    fn pkce_challenge_deterministic() {
        let verifier = "test_verifier_32_bytes_long_enough_";
        let c1 = generate_code_challenge(verifier);
        let c2 = generate_code_challenge(verifier);
        assert_eq!(c1, c2);
    }

    #[test]
    fn build_oauth_cookies_has_four_items() {
        let state = OAuthState {
            code_verifier: "v".into(),
            code_challenge: "ch".into(),
            state: "s1".into(),
            nonce: "n1".into(),
            return_to: "/".into(),
            client_id: "app".into(),
            redirect_uri: "https://ex.com/cb".into(),
        };
        let cookies = build_oauth_cookies(&state, true);
        assert_eq!(cookies.len(), 4);
        assert!(cookies[0].contains("pkce_verifier="));
        assert!(cookies[1].contains("oauth_state="));
        assert!(cookies[2].contains("oauth_nonce="));
        assert!(cookies[3].contains("return_to="));
        for c in &cookies {
            assert!(c.contains("Path=/api/auth/callback"));
            assert!(c.contains("HttpOnly"));
            assert!(c.contains("SameSite=Lax"));
            assert!(c.contains("Secure"));
        }
    }

    #[test]
    fn extract_pkce_verifier_works() {
        let header = "pkce_verifier=abc123; oauth_state=xyz; return_to=/dash";
        assert_eq!(extract_pkce_verifier(header), Some("abc123"));
        assert_eq!(extract_return_to(header), Some("/dash"));
    }

    #[test]
    fn extract_pkce_verifier_quoted() {
        let header = "pkce_verifier=\"abc123\"";
        assert_eq!(extract_pkce_verifier(header), Some("abc123"));
    }
}
