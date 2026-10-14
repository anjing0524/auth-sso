//! OAuth 2.1 Client 编排 — 从 gateway.rs 拆分（A3-2 / ADR-010 二期）。
//!
//! 职责：未认证 HTML 导航的 PKCE 302 生成、callback 拦截（state/nonce 校验、
//! code→token 交换、会话 Cookie 下发）与 /token 端点调用。
//! 凭据统一取自网关级 `[gateway.oauth]`（`Gateway.oauth`）。

use pingora_core::prelude::*;
use pingora_proxy::Session;
use tracing::{info, warn};

use super::gateway::{Gateway, get_host};
use crate::config::{OAuthConfig, Upstreams};
use crate::http::SessionExt;
use crate::oauth;

/// `/authorize` 请求里的 scope 查询参数段（URL 编码形态，`+` 为分隔符）。
///
/// **跨语言契约**：集合必须与 contracts `SCOPES_SUPPORTED` 一致（由 `contract_tests` 断言）。
/// 收窄 Portal 侧 client 的注册 scopes 而不改这里，网关的登录跳转就会拿到 `invalid_scope`。
pub(crate) const AUTHORIZE_SCOPE_QUERY: &str = "openid+profile+email+offline_access";

/// Token 交换结果（code → access_token + refresh_token + id_token）
#[derive(Debug, Clone)]
pub(crate) struct TokenExchangeResult {
    pub(crate) access: String,
    pub(crate) refresh: String,
    pub(crate) id_token: Option<String>,
}

/// 单次 token 交换尝试的**结果**——刻意与 HTTP 库解耦，使决策表可穷举测试。
#[derive(Debug, Clone)]
pub(crate) enum ExchangeAttempt {
    /// 传输层失败（不可达 / 超时）
    Transport,
    /// 收到响应但状态非 2xx（附响应体文本）
    Status(u16, String),
    /// 2xx 且响应体已解析为 JSON
    Body(serde_json::Value),
}

/// 决策表的输出。
#[derive(Debug)]
pub(crate) enum ExchangeStep {
    /// 换下一节点重试（仅传输层失败）
    RetryNextNode,
    /// **确定性拒绝**：换节点不会改变结果（HTTP 非 2xx，或 2xx 但响应体不可用）
    Reject { status: u16, message: String },
    /// 成功
    Parsed(TokenExchangeResult),
}

/// **Token 交换的决策表**（纯函数、零 I/O）。
///
/// 语义（原先内联在 `do_token_exchange` 的分支里，本文件零测试）：
/// - **网络错误**（不可达/超时）→ 试下一节点（`RetryNextNode`）；
/// - **HTTP 非 2xx**（如 `invalid_grant`）→ **确定性拒绝**，立即返回该错误、不重试；
/// - **2xx** → 解析响应体；缺字段/空值 → 按 502 拒绝。
///
/// 抽成纯函数的理由：这三条是**业务语义**，却只能靠起一个 HTTP 服务器才能验证；
/// 决策与 I/O 分开后，决策表可以逐条穷举（见 `oauth_flow/tests.rs`）。
pub(crate) fn decide_exchange(attempt: ExchangeAttempt) -> ExchangeStep {
    match attempt {
        ExchangeAttempt::Transport => ExchangeStep::RetryNextNode,
        ExchangeAttempt::Status(status, text) => ExchangeStep::Reject {
            status,
            message: format!("Token 交换失败 ({status}): {text}"),
        },
        ExchangeAttempt::Body(json) => match parse_token_exchange_response(json) {
            Ok(tokens) => ExchangeStep::Parsed(tokens),
            Err(message) => ExchangeStep::Reject {
                status: 502,
                message,
            },
        },
    }
}

/// Token 交换执行体——**自持依赖**（上游节点列表 + 协议 scheme）。
///
/// 它只持有自己需要的东西，因此 `Gateway` 的 `oidc_provider_upstream` 与
/// `upstream_scheme` **不必**为了跨模块访问而放宽可见性（装配点在 `gateway.rs` 内的
/// `Gateway::token_exchange`，那里能合法读私有字段）。
pub(crate) struct TokenExchange<'a> {
    upstreams: &'a Upstreams,
    scheme: &'a str,
}

impl<'a> TokenExchange<'a> {
    pub(crate) fn new(upstreams: &'a Upstreams, scheme: &'a str) -> Self {
        Self { upstreams, scheme }
    }

    /// 依次尝试各上游节点执行 `code → token` 交换，按 [`decide_exchange`] 的决策表处理。
    ///
    /// 所有节点网络失败 → 502。
    pub(crate) async fn exchange(&self, body: &serde_json::Value) -> Result<TokenExchangeResult> {
        for node in self.upstreams.iter() {
            let token_url = format!("{}://{node}/api/auth/oauth2/token", self.scheme);
            let attempt = match crate::http::HTTP_CLIENT
                .post(&token_url)
                .header("Content-Type", "application/json")
                .json(body)
                .send()
                .await
            {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        match resp.json::<serde_json::Value>().await {
                            Ok(json) => ExchangeAttempt::Body(json),
                            Err(e) => {
                                // 2xx 但响应体不可解析：确定性拒绝（换节点不会改变结果）
                                ExchangeAttempt::Status(502, format!("Token 响应解析失败: {e}"))
                            }
                        }
                    } else {
                        let text = resp.text().await.unwrap_or_default();
                        ExchangeAttempt::Status(status.as_u16(), text)
                    }
                }
                Err(e) => {
                    warn!("Token 端点不可达: {}: {e}，尝试下一节点", token_url);
                    ExchangeAttempt::Transport
                }
            };

            match decide_exchange(attempt) {
                ExchangeStep::RetryNextNode => continue,
                ExchangeStep::Reject { status, message } => {
                    return Err(Error::explain(ErrorType::HTTPStatus(status), message));
                }
                ExchangeStep::Parsed(tokens) => return Ok(tokens),
            }
        }

        Err(Error::explain(
            ErrorType::HTTPStatus(502),
            "OIDC Provider 所有节点均不可达，无法执行 Token 交换".to_string(),
        ))
    }
}

impl Gateway {
    /// 无 JWT 页面导航 → 生成 PKCE + Cookie → 302 /authorize
    /// 生成 PKCE 跳转并用 302 回给浏览器。
    ///
    /// `extra_cookies` 用于"续签已轮换、但本次请求仍需重登"的场景：新 Token Cookie
    /// 必须随这个 302 一并送达，否则浏览器会继续用已被 Portal 撤销的旧 RT。
    pub(crate) async fn oauth_authorize_redirect(
        &self,
        session: &mut Session,
        oauth: &OAuthConfig,
        return_to: &str,
        extra_cookies: &[String],
    ) -> Result<bool> {
        let host = get_host(session);
        // Gateway 主代理服务本身就是浏览器的 TLS 第一跳。走到这里的浏览器请求
        // 已经在 HTTPS 监听端口内，OAuth redirect_uri 与临时 Cookie 必须按 HTTPS 生成，
        // 不能再因为 loopback/localhost 主机名而退化为 http://...:443/19443。
        const SECURE: bool = true;

        let callback_path = self.oauth_callback_path();

        let state = oauth::build_oauth_state(oauth, host, return_to, &callback_path, SECURE)
            .map_err(|e| {
                Error::explain(
                    ErrorType::HTTPStatus(500),
                    format!("构建 OAuth state 失败: {e}"),
                )
            })?;
        // /authorize URL 的 scheme:host 段与 redirect_uri 同一函数构造，消除两处 scheme 翻译
        let authorize_base = oauth::build_redirect_uri(host, "/api/auth/oauth2/authorize", SECURE);
        let auth_url = format!(
            "{}?response_type=code&client_id={}&redirect_uri={}&\
            scope={AUTHORIZE_SCOPE_QUERY}&code_challenge={}&\
            code_challenge_method=S256&state={}&nonce={}",
            authorize_base,
            state.client_id,
            urlencoding::encode(&state.redirect_uri),
            state.code_challenge,
            state.state,
            state.nonce,
        );

        let mut cookies = oauth::build_oauth_cookies(&state, SECURE);
        // 续签已轮换时的会话 Cookie 附在同一响应上（见函数文档）
        cookies.extend(extra_cookies.iter().cloned());

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

        // 决策表与 I/O 分开：本函数只负责"拼请求体 + 交给执行体"
        self.token_exchange().exchange(&body).await
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
        cookie_header: Option<&str>,
        code: &str,
        state_param: &str,
    ) -> Result<bool> {
        let host = get_host(session);
        // 与 /authorize 阶段保持同一条边界事实：Gateway callback 始终经 HTTPS 到达。
        const SECURE: bool = true;
        let Some(ck) = cookie_header else {
            warn!("OAuth callback 缺少 Cookie");
            return Self::oauth_error_redirect(session, "invalid_state").await;
        };

        // 判定提取为纯函数（`oauth::state_matches`）：可穷举测试、fail-close
        let cookie_state = oauth::extract_oauth_state(ck);
        if !oauth::state_matches(cookie_state, state_param) {
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

        let callback_path = self.oauth_callback_path();

        // 与 /authorize 阶段同一函数（oauth::build_redirect_uri）构造，
        // 保证 OAuth 2.1 两阶段 redirect_uri 逐字节一致
        let redirect_uri = oauth::build_redirect_uri(host, &callback_path, SECURE);

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

        // nonce 一致性 fail-close 双向闭合（OIDC Core §3.1.2.2）：判定提取为纯函数
        // `oauth::nonce_matches` —— 原先内联的 match 在本文件里零测试。
        let id_nonce = tokens
            .id_token
            .as_deref()
            .and_then(oauth::decode_id_token_nonce);
        if !oauth::nonce_matches(cookie_nonce, id_nonce.as_deref()) {
            warn!("OAuth callback nonce 不匹配");
            return Self::oauth_error_redirect(session, "nonce_mismatch").await;
        }

        let session_cookies = oauth::build_session_cookies(&tokens.access, &tokens.refresh, SECURE);
        let clear_cookies = oauth::build_clear_oauth_cookies(SECURE, &callback_path);

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
///
/// 返回 `Err(消息)` 而非 `Error`：本函数是**纯解析**，消息即拒绝原因，
/// 由调用方（决策表 / `TokenExchange::exchange`）统一包装成 502。
fn parse_token_exchange_response(json: serde_json::Value) -> Result<TokenExchangeResult, String> {
    let access = json["access_token"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Token 响应中缺少 access_token 字段".to_string())?;
    let refresh = json["refresh_token"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Token 响应中缺少 refresh_token 字段".to_string())?;

    Ok(TokenExchangeResult {
        access: access.to_string(),
        refresh: refresh.to_string(),
        id_token: json["id_token"].as_str().map(String::from),
    })
}

/// 单元测试模块，外置于 `oauth_flow/tests.rs`
#[cfg(test)]
mod tests;
