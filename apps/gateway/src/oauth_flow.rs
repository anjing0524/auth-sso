//! OAuth 2.1 Client 编排 — 从 gateway.rs 拆分（A3-2 / ADR-010 二期）。
//!
//! 职责：未认证 HTML 导航的 PKCE 302 生成、callback 拦截（state/nonce 校验、
//! code→token 交换、会话 Cookie 下发）与 /token 端点调用。
//! 凭据统一取自网关级 `[gateway.oauth]`（`Gateway.oauth`）。

use pingora_core::prelude::*;
use pingora_proxy::Session;
use tracing::{info, warn};

use super::gateway::{Gateway, get_host};
use crate::config::OAuthConfig;
use crate::http::SessionExt;
use crate::oauth;

/// Token 交换结果（code → access_token + refresh_token + id_token）
#[derive(Debug, Clone)]
pub(crate) struct TokenExchangeResult {
    pub(crate) access: String,
    pub(crate) refresh: String,
    pub(crate) id_token: Option<String>,
}

impl Gateway {
    /// 无 JWT 页面导航 → 生成 PKCE + Cookie → 302 /authorize
    pub(crate) async fn oauth_authorize_redirect(
        &self,
        session: &mut Session,
        oauth: &OAuthConfig,
        return_to: &str,
    ) -> Result<bool> {
        let host = get_host(session);
        // Gateway 主代理服务本身就是浏览器的 TLS 第一跳。走到这里的浏览器请求
        // 已经在 HTTPS 监听端口内，OAuth redirect_uri 与临时 Cookie 必须按 HTTPS 生成，
        // 不能再因为 loopback/localhost 主机名而退化为 http://...:443/19443。
        let secure = true;

        let callback_path = self.jwks_cache.callback_path_or_default();

        let state = oauth::build_oauth_state(oauth, host, return_to, &callback_path, secure)
            .map_err(|e| {
                Error::explain(
                    ErrorType::HTTPStatus(500),
                    format!("构建 OAuth state 失败: {e}"),
                )
            })?;
        let scheme = if secure { "https" } else { "http" };
        let auth_url = format!(
            "{scheme}://{host}/api/auth/oauth2/authorize?\
            response_type=code&client_id={}&redirect_uri={}&\
            scope=openid+profile+email+offline_access&code_challenge={}&\
            code_challenge_method=S256&state={}&nonce={}",
            state.client_id,
            urlencoding::encode(&state.redirect_uri),
            state.code_challenge,
            state.state,
            state.nonce,
        );

        let cookies = oauth::build_oauth_cookies(&state, secure);

        info!(
            "OAuth PKCE redirect: {} → /authorize (client={}, return_to={})",
            host, oauth.client_id, return_to
        );

        session
            .respond_302_with_cookies(&auth_url, &cookies)
            .await?;
        Ok(true)
    }

    /// 内部调用 OIDC Provider 的 POST /api/auth/oauth2/token 进行 code→token 交换。
    ///
    /// 故障转移语义：**网络错误**（不可达/超时）→ 尝试下一节点；
    /// **HTTP 非 2xx**（如 invalid_grant）→ 确定性拒绝，立即返回该错误不重试。
    /// 所有节点网络失败 → 502。
    async fn do_token_exchange(
        &self,
        code: &str,
        code_verifier: &str,
        client_id: &str,
        client_secret: &str,
        redirect_uri: &str,
    ) -> Result<TokenExchangeResult> {
        let body = oauth::build_token_exchange_body(
            code,
            code_verifier,
            client_id,
            client_secret,
            redirect_uri,
        );

        for node in self.oidc_provider_upstream.iter() {
            let token_url = format!("{}://{node}/api/auth/oauth2/token", self.upstream_scheme);
            let resp = match crate::http::HTTP_CLIENT
                .post(&token_url)
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    warn!("Token 端点不可达: {}: {e}，尝试下一节点", token_url);
                    continue;
                }
            };

            if !resp.status().is_success() {
                // 确定性拒绝（如 invalid_grant）：换节点重试不会改变结果
                let status = resp.status().as_u16();
                let text = resp.text().await.unwrap_or_default();
                return Err(Error::explain(
                    ErrorType::HTTPStatus(status),
                    format!("Token 交换失败 ({}): {text}", status),
                ));
            }

            let json: serde_json::Value = resp.json().await.map_err(|e| {
                Error::explain(
                    ErrorType::HTTPStatus(502),
                    format!("Token 响应解析失败: {e}"),
                )
            })?;
            return parse_token_exchange_response(json);
        }

        Err(Error::explain(
            ErrorType::HTTPStatus(502),
            "OIDC Provider 所有节点均不可达，无法执行 Token 交换".to_string(),
        ))
    }

    /// OAuth callback 错误 → 302 重定向到登录页并终止请求处理。
    async fn oauth_error_redirect(session: &mut Session, reason: &str) -> Result<bool> {
        let url = format!("/login?error={reason}");
        session.respond_302_with_cookies(&url, &[]).await?;
        Ok(true)
    }

    /// OAuth callback 拦截：CSRF state + nonce 校验 + Token 交换 + Cookie 清除
    pub(crate) async fn handle_oauth_callback(
        &self,
        session: &mut Session,
        oauth: &OAuthConfig,
        cookie_header: &Option<String>,
        code: &str,
        state_param: &str,
    ) -> Result<bool> {
        let host = get_host(session);
        // 与 /authorize 阶段保持同一条边界事实：Gateway callback 始终经 HTTPS 到达。
        let secure = true;
        let ck = match cookie_header.as_deref() {
            Some(c) => c,
            None => {
                warn!("OAuth callback 缺少 Cookie");
                return Self::oauth_error_redirect(session, "invalid_state").await;
            }
        };

        let cookie_state = oauth::extract_oauth_state(ck);
        if cookie_state != Some(state_param) {
            warn!(
                "OAuth callback CSRF state 不匹配: cookie={:?} query={}",
                cookie_state, state_param
            );
            return Self::oauth_error_redirect(session, "csrf_mismatch").await;
        }

        let Some(verifier) = oauth::extract_pkce_verifier(ck) else {
            warn!("OAuth callback 缺少 pkce_verifier");
            return Self::oauth_error_redirect(session, "invalid_state").await;
        };

        let cookie_nonce = oauth::extract_oauth_nonce(ck);

        let return_to = oauth::extract_return_to(ck)
            .and_then(oauth::safe_redirect_path)
            .unwrap_or_else(|| "/".to_string());

        let callback_path = self.jwks_cache.callback_path_or_default();

        // 与 /authorize 阶段同一函数（oauth::build_redirect_uri）构造，
        // 保证 OAuth 2.1 两阶段 redirect_uri 逐字节一致
        let redirect_uri = oauth::build_redirect_uri(host, &callback_path, secure);

        let tokens = match self
            .do_token_exchange(
                code,
                verifier,
                &oauth.client_id,
                &oauth.client_secret,
                &redirect_uri,
            )
            .await
        {
            Ok(t) => t,
            Err(e) => {
                warn!("Token 交换失败: {:?}", e);
                return Self::oauth_error_redirect(session, "token_exchange_failed").await;
            }
        };

        if let Some(nonce) = cookie_nonce
            && let Some(ref id_token) = tokens.id_token
        {
            let id_nonce = oauth::decode_id_token_nonce(id_token);
            if id_nonce.as_deref() != Some(nonce) {
                warn!("OAuth callback nonce 不匹配");
                return Self::oauth_error_redirect(session, "nonce_mismatch").await;
            }
        }

        let session_cookies = oauth::build_session_cookies(&tokens.access, &tokens.refresh, secure);
        let clear_cookies = oauth::build_clear_oauth_cookies(secure, &callback_path);

        info!(
            "OAuth callback 完成: client={}, return_to={}",
            oauth.client_id, return_to
        );
        session
            .respond_302_with_cookies(&return_to, &[session_cookies, clear_cookies].concat())
            .await?;
        Ok(true)
    }
}

/// 从 /token 端点 JSON 响应中解析 access_token / refresh_token / id_token。
fn parse_token_exchange_response(json: serde_json::Value) -> Result<TokenExchangeResult> {
    let access = json["access_token"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            Error::explain(
                ErrorType::HTTPStatus(502),
                "Token 响应中缺少 access_token 字段".to_string(),
            )
        })?;
    let refresh = json["refresh_token"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            Error::explain(
                ErrorType::HTTPStatus(502),
                "Token 响应中缺少 refresh_token 字段".to_string(),
            )
        })?;

    Ok(TokenExchangeResult {
        access: access.to_string(),
        refresh: refresh.to_string(),
        id_token: json["id_token"].as_str().map(String::from),
    })
}
