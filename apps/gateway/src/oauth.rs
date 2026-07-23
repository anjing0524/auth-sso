//! OAuth 2.1 Client 层：PKCE (S256) 生成、Cookie 构造、/authorize URL 构建。
//!
//! Gateway 为每个下游应用统一执行 OAuth Client 职责：
//! 1. 无 JWT 页面导航 → 生成 PKCE/state/nonce/return_to → Set-Cookie → 302 /authorize
//! 2. callback 回调 → 从 Cookie 取 verifier → POST /token → Set-Cookie 下发 token → 302 return_to

use base64::Engine;
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::auth::{ACCESS_TOKEN_MAX_AGE_SEC, REFRESH_TOKEN_MAX_AGE_SEC};
use crate::config::OAuthConfig;
use crate::cookie;

/// OAuth 2.1 Client 层的错误类型
#[derive(Error, Debug)]
pub enum OAuthError {
    /// 系统 CSPRNG 熵池枯竭（无法生成安全的随机 token）
    #[error("系统 CSPRNG 熵池枯竭: {0}")]
    EntropyFailure(String),
}

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
    /// Gateway 拦截 OAuth callback 的路径（如 `/api/auth/callback`）
    pub callback_path: String,
}

// ── OAuth 2.1 Client Cookie 名称（必须与 Portal /callback/route.ts 完全一致）──

const PKCE_VERIFIER_COOKIE: &str = "pkce_verifier";
const OAUTH_STATE_COOKIE: &str = "oauth_state";
const OAUTH_NONCE_COOKIE: &str = "oauth_nonce";
const RETURN_TO_COOKIE: &str = "return_to";

/// 临时 OAuth Cookie 的 TTL（秒）— 与 authorization_code 5min 对齐
const OAUTH_COOKIE_MAX_AGE: u64 = 300;

// ── 密码学随机生成 ──

/// 从系统 CSPRNG（getrandom）取 `N` 字节随机数，base64url 无 padding 编码为字符串。
///
/// PKCE verifier、OAuth state、OIDC nonce 三者都依赖不可预测性，统一走此函数。
/// `getrandom` 在 Linux 用 getrandom(2)、macOS 用 SecRandomCopyBytes、
/// Windows 用 BCryptGenRandom，均为内核级 CSPRNG。
///
/// # 错误
/// 系统熵池枯竭时返回 [`OAuthError::EntropyFailure`]——降级生成可预测 token
/// 是安全漏洞，必须阻止启动或请求处理。
fn random_token<const N: usize>() -> Result<String, OAuthError> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).map_err(|e| OAuthError::EntropyFailure(e.to_string()))?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

// ── PKCE 生成 ──

/// 生成 PKCE code_verifier（43 字符，符合 RFC 7636 §4.1 规定的 43–128 字符范围）。
///
/// 32 字节（256 bit）经 base64url 编码得到 43 字符——即 RFC 下限对应的熵量。
/// 与 Portal `generateCodeVerifier()`（32 字节 `crypto.getRandomValues` → base64url）
/// 实现等价；challenge 仅校验 SHA256 哈希，两端完全自洽。
pub fn generate_code_verifier() -> Result<String, OAuthError> {
    random_token::<32>()
}

/// 生成 PKCE S256 code_challenge
///
/// `code_challenge = BASE64URL(SHA256(code_verifier))`，符合 RFC 7636 §4.2。
pub fn generate_code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

/// 生成一次性 PKCE 密钥对
pub fn generate_pkce() -> Result<PkcePair, OAuthError> {
    let verifier = generate_code_verifier()?;
    let challenge = generate_code_challenge(&verifier);
    Ok(PkcePair {
        verifier,
        challenge,
    })
}

/// 生成随机 OAuth state / OIDC nonce（32 字节 → 43 字符，256 bit 不可预测）。
fn random_state() -> Result<String, OAuthError> {
    random_token::<32>()
}

// ── OAuth State ──

/// 构建 OAuth 2.1 所需的完整 redirect_uri（scheme://host/callback_path）。
///
/// 供 `/authorize`（`build_oauth_state`）与 `/token`（`handle_oauth_callback`）两阶段
/// 共享，确保两处的 redirect_uri 由同一函数计算、逐字节一致——消除 OAuth 交换 400 的漂移面。
pub fn build_redirect_uri(host: &str, callback_path: &str, secure: bool) -> String {
    format!(
        "{}://{}{}",
        if secure { "https" } else { "http" },
        host,
        callback_path,
    )
}

/// 构建一次授权请求所需的完整 OAuth state（PKCE + state + nonce + redirect_uri）。
///
/// `secure` 由调用方用 [`crate::http::is_secure_host`] 计算一次传入——
/// `/authorize` 与 `/token` 两阶段的 redirect_uri scheme 由同一函数决定，
/// 杜绝 OAuth 2.1 redirect_uri 不匹配导致的交换 400。
pub fn build_oauth_state(
    oauth_config: &OAuthConfig,
    origin_host: &str,
    return_to: &str,
    callback_path: &str,
    secure: bool,
) -> Result<OAuthState, OAuthError> {
    let pkce = generate_pkce()?;
    let redirect_uri = build_redirect_uri(origin_host, callback_path, secure);

    Ok(OAuthState {
        code_verifier: pkce.verifier,
        code_challenge: pkce.challenge,
        state: random_state()?,
        nonce: random_state()?,
        return_to: return_to.to_string(),
        client_id: oauth_config.client_id.clone(),
        redirect_uri,
        callback_path: callback_path.to_string(),
    })
}

// ── Cookie 构造 ──

/// 构造单个 Set-Cookie 头值
fn build_set_cookie(name: &str, value: &str, max_age: u64, path: &str, secure: bool) -> String {
    let secure_str = if secure { "; Secure" } else { "" };
    format!("{name}={value}; Path={path}; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure_str}")
}

/// 构造 OAuth Client 四个临时 HttpOnly Cookie 的 Set-Cookie 头值列表
///
/// Cookie 列表:
/// - pkce_verifier   — PKCE code_verifier
/// - oauth_state     — OAuth state（CSRF 防护）
/// - oauth_nonce     — OIDC nonce（防重放）
/// - return_to       — 登录完成后回跳路径
///
/// Path 从 OIDC Discovery 动态获取，仅在 callback 端点携带，
/// 5 分钟 TTL 与 authorization_code 对齐。
pub fn build_oauth_cookies(state: &OAuthState, secure: bool) -> Vec<String> {
    let path = &state.callback_path;
    vec![
        build_set_cookie(
            PKCE_VERIFIER_COOKIE,
            &state.code_verifier,
            OAUTH_COOKIE_MAX_AGE,
            path,
            secure,
        ),
        build_set_cookie(
            OAUTH_STATE_COOKIE,
            &state.state,
            OAUTH_COOKIE_MAX_AGE,
            path,
            secure,
        ),
        build_set_cookie(
            OAUTH_NONCE_COOKIE,
            &state.nonce,
            OAUTH_COOKIE_MAX_AGE,
            path,
            secure,
        ),
        build_set_cookie(
            RETURN_TO_COOKIE,
            &state.return_to,
            OAUTH_COOKIE_MAX_AGE,
            path,
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
pub fn build_clear_oauth_cookies(secure: bool, callback_path: &str) -> Vec<String> {
    let secure_str = if secure { "; Secure" } else { "" };
    let cookie_attrs =
        format!("; Path={callback_path}; HttpOnly; SameSite=Lax; Max-Age=0{secure_str}");
    vec![
        format!("{PKCE_VERIFIER_COOKIE}={cookie_attrs}"),
        format!("{OAUTH_STATE_COOKIE}={cookie_attrs}"),
        format!("{OAUTH_NONCE_COOKIE}={cookie_attrs}"),
        format!("{RETURN_TO_COOKIE}={cookie_attrs}"),
    ]
}

// ── 重定向消毒 ──

/// 验证 return_to 是否为同源相对路径（防开放重定向）。
///
/// 三条预检：
/// 1. 非空、以单 `/` 开头
/// 2. 非 `//`（协议相对 URL）或 `/\`（反斜杠绕过）
/// 3. `reqwest::Url::parse("http://localhost" + target)` 后 host 仍为 `localhost`
///
/// 与 Portal `safeRedirectPath` (`oauth-utils.ts:60-72`) 等价。
pub fn safe_redirect_path(target: &str) -> Option<String> {
    if target.is_empty() {
        return None;
    }
    // 必须以单个 `/` 开头，禁止 `//`（协议相对）和 `/\`（反斜杠绕过）
    if !target.starts_with('/') || target.starts_with("//") || target.starts_with("/\\") {
        return None;
    }
    // URL 解析同源校验
    let base = "http://localhost";
    let url = reqwest::Url::parse(&format!("{}{}", base, target)).ok()?;
    if url.host_str() != Some("localhost") {
        return None;
    }
    // 拼接 path + query + fragment 作为消毒结果
    let mut result = url.path().to_string();
    if let Some(q) = url.query() {
        result.push('?');
        result.push_str(q);
    }
    if let Some(f) = url.fragment() {
        result.push('#');
        result.push_str(f);
    }
    // 保留前导 `/`（path 方法去掉连续斜杠，但合法路径始终以 `/` 开头）
    if result.is_empty() {
        result.push('/');
    }
    Some(result)
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

/// 从 ID Token JWT payload 解码 nonce claim（不验签，仅一致性比对）。
///
/// 使用 `serde_json::Value` 解析 payload JSON，
/// 替代手写字符串查找——对字段顺序、空白、转义等变体更鲁棒。
pub fn decode_id_token_nonce(id_token: &str) -> Option<String> {
    let bytes = crate::auth::jwt_payload_bytes(id_token)?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    value.get("nonce")?.as_str().map(String::from)
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
        let v = generate_code_verifier().unwrap();
        assert_eq!(v.len(), 43);
        assert!(
            v.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        );
    }

    #[test]
    fn pkce_challenge_is_valid_base64url() {
        let pair = generate_pkce().unwrap();
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
            callback_path: "/api/auth/callback".into(),
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

    #[test]
    fn safe_redirect_path_valid() {
        assert_eq!(safe_redirect_path("/"), Some("/".into()));
        assert_eq!(safe_redirect_path("/dashboard"), Some("/dashboard".into()));
        assert_eq!(safe_redirect_path("/a/b?c=d#e"), Some("/a/b?c=d#e".into()));
    }

    #[test]
    fn safe_redirect_path_rejects_open_redirects() {
        assert_eq!(safe_redirect_path("//evil.com"), None);
        assert_eq!(safe_redirect_path("/\\evil.com"), None);
        assert_eq!(safe_redirect_path("http://evil.com"), None);
        assert_eq!(safe_redirect_path("https://evil.com/path"), None);
        assert_eq!(safe_redirect_path(""), None);
        assert_eq!(safe_redirect_path("javascript:alert(1)"), None);
    }
}
