use async_trait::async_trait;
use pingora_core::prelude::*;
use pingora_http::{RequestHeader, ResponseHeader};
use pingora_proxy::{ProxyHttp, Session};
use std::sync::{Arc, OnceLock};
use tracing::{debug, info, warn};

use crate::auth::{JwtVerifier, RefreshedTokens, TokenRefresher};
use crate::config::{OAuthConfig, Upstreams};
use crate::cookie;

/// 内部上游请求协议（http/https），由 Gateway::new() 初始化后只读
static UPSTREAM_SCHEME: OnceLock<String> = OnceLock::new();

/// 获取上游请求协议（如 "http" 或 "https"）
pub fn upstream_scheme() -> &'static str {
    UPSTREAM_SCHEME.get().map(|s| s.as_str()).unwrap_or("http")
}
use crate::http::{SessionExt, is_html_page_navigation, is_secure_host};
use crate::oauth;
use crate::path_matcher::{PathClass, PathMatcher};
use crate::router::Router;
use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// 计算 HMAC-SHA256 并以十六进制字符串返回。
/// 用于 Gateway → Portal 信任路径签名。
fn compute_hmac_sha256_hex(secret: &str, payload: &str) -> String {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC-SHA256 应从任意长度的密钥创建");
    mac.update(payload.as_bytes());
    let result = mac.finalize();
    hex::encode(result.into_bytes())
}

/// Pingora `LoadBalancer::select` 的第二参数为选择输入的哈希键；
/// 传 `b""` 表示纯轮询（不做一致性哈希），256 为保留的总权重占位。
///
/// 见 pingora-load-balancing 0.8 `select(&self, key: &[u8], total_weight: usize)`。
const UPSTREAM_SELECT_WEIGHT: usize = 256;

/// 从 Session 提取指定请求头的字符串值
fn header_str<'s>(session: &'s Session, name: &str) -> Option<&'s str> {
    session.get_header(name).and_then(|h| h.to_str().ok())
}

/// 获取请求的 Host，优先从 HTTP/2 authority 或 Host 头中提取以保证包含端口号
fn get_host(session: &Session) -> &str {
    if let Some(auth) = session.req_header().uri.authority() {
        return auth.as_str();
    }
    if let Some(auth) = session
        .get_header(":authority")
        .and_then(|h| h.to_str().ok())
    {
        return auth;
    }
    if let Some(host) = session.get_header("Host").and_then(|h| h.to_str().ok()) {
        return host;
    }
    "localhost"
}

/// 当 `value` 为 `Some` 时向请求头注入；`None` 视为 no-op
fn insert_opt_header(
    req: &mut RequestHeader,
    name: &'static str,
    value: Option<&str>,
) -> Result<()> {
    if let Some(v) = value {
        req.insert_header(name, v)?;
    }
    Ok(())
}

/// 判断某请求头是否属于「身份相关」头，应在转发前剥离。
///
/// 采用**黑名单兜底**策略：除少数显式允许的代理标准头外，
/// 所有 `X-` 前缀头 + `Authorization` 一律剥离。
/// 这样未来新增任何 `X-` 身份头（如 `X-Auth-Token`、`X-Session-Id`、
/// `X-Token`、`X-Admin` 等）都默认被剥离，无需同步维护白名单——
/// 这是零信任的核心防线，下游收到的身份信息 100% 由 gateway 权威注入。
///
/// **保留**的头（非身份语义，必须显式放行）：
/// - `X-Forwarded-*`（代理链路标准头，见 RFC 7239）
/// - `X-Request-Id` / `X-Correlation-Id`（链路追踪）
/// - `X-Real-IP`（代理客户端 IP，部分下游依赖）
///
/// `X-Client-IP` / `X-Client-UA` 虽由 gateway 注入，但属身份语义，
/// 仍剥离后重新注入——不在此放行清单中。
fn is_identity_header(name_lower: &str) -> bool {
    // Authorization 始终剥离（由 gateway 按验签结果重新注入）
    if name_lower == "authorization" {
        return true;
    }
    // 非 X- 前缀头不剥离（Accept、Cookie、Host 等业务头）
    if !name_lower.starts_with("x-") {
        return false;
    }
    // 显式放行的代理标准头（非身份语义）
    if name_lower.starts_with("x-forwarded-")
        || name_lower == "x-request-id"
        || name_lower == "x-correlation-id"
        || name_lower == "x-real-ip"
    {
        return false;
    }
    // 其余所有 X- 前缀头默认剥离（黑名单兜底）
    true
}

/// 零信任前置清洗：剥离上行请求中所有「身份相关」头。
///
/// 无论请求是否通过验签，都先清空客户端可能伪造的身份头，
/// 再由后续注入逻辑按验签结果权威写入。这样下游收到的身份信息
/// 100% 来自 gateway，杜绝伪造透传。
///
/// 因 Pingora `RequestHeader` 借用限制，先经只读 `map` 收集待删头名，
/// 再逐个 `remove_header`（替换语义，删除该名下所有同名头）。
fn strip_identity_headers(req: &mut RequestHeader) {
    let mut to_remove: Vec<String> = Vec::new();
    // map 是只读遍历（统一 H1 case 敏感 / H2 大小写无关两种表示）
    let _ = req.map(|variant, _| {
        let name_lower: String = match variant {
            pingora_http::HeaderNameVariant::Case(cn) => std::str::from_utf8(cn.as_slice())
                .unwrap_or("")
                .to_ascii_lowercase(),
            pingora_http::HeaderNameVariant::Titled(s) => s.to_ascii_lowercase(),
        };
        if is_identity_header(&name_lower) {
            to_remove.push(name_lower);
        }
        Ok(())
    });
    for name in to_remove {
        req.remove_header(&name);
    }
}

/// 已通过验签的请求身份 — Authorization 头、用户 ID、jti 三者同生共死，
/// 作为一个整体在请求生命周期中流转（验签成功一起注入，续签成功一起覆盖）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    /// 预格式化的 Authorization 头部值（例如 `Bearer <token>`）
    pub auth_header: String,
    /// 用户 ID（从 JWT Claims.sub 提取）
    pub user_id: String,
    /// JWT 唯一标识（从 JWT Claims.jti 提取）
    pub user_jti: String,
}

/// 网关请求上下文类型，用于在代理生命周期中传递已解析的身份与分类信息
#[derive(Default, Debug)]
pub struct GatewayCtx {
    /// 当前请求的路径分类（在 request_filter 中一次计算，upstream 阶段复用）
    pub path_class: PathClass,
    /// 已验签身份（None 表示未通过验签的白名单/静态路径）
    pub identity: Option<Identity>,
    /// 续签得到的新 Token（若在本次请求中触发了静默续签）
    pub refreshed_tokens: Option<RefreshedTokens>,
    /// OAuth callback 透传状态（无 client_secret 的 upstream 回调时设置）
    pub oauth_passthrough_verifier: Option<String>,
}

impl GatewayCtx {
    /// 是否已通过验签（即上行应注入身份 Header）
    ///
    /// # Examples
    ///
    /// ```
    /// # use gateway::gateway::GatewayCtx;
    /// let ctx = GatewayCtx::default();
    /// assert!(!ctx.is_authenticated());
    /// ```
    pub fn is_authenticated(&self) -> bool {
        self.identity.is_some()
    }
}

/// Token 交换结果（code → access_token + refresh_token + id_token）
#[derive(Debug, Clone)]
struct TokenExchangeResult {
    access: String,
    refresh: String,
    id_token: Option<String>,
}

/// 从 query string 提取指定参数值，零分配简单解析
fn query_param<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    let key_eq = key.as_bytes();
    let query_bytes = query.as_bytes();
    let len = query_bytes.len();
    let klen = key_eq.len();
    let mut i = 0;
    while i < len {
        if i + klen < len
            && query_bytes[i..i + klen].eq_ignore_ascii_case(key_eq)
            && query_bytes[i + klen] == b'='
        {
            let val_start = i + klen + 1;
            let val_end = query_bytes[val_start..]
                .iter()
                .position(|&b| b == b'&')
                .map_or(len, |p| val_start + p);
            return std::str::from_utf8(&query_bytes[val_start..val_end]).ok();
        }
        i += query_bytes[i..]
            .iter()
            .position(|&b| b == b'&')
            .map_or(len - i, |p| p + 1);
    }
    None
}

/// Auth-SSO 去中心化安全网关 — 基于 Pingora (0.8.0 + OpenSSL)
///
/// 负责代理编排：路由分类 → 限流检查 → OAuth 2.1 Client 层（PKCE + callback 拦截）
/// → JWT 鉴权与静默续签 → 请求转发。
///
/// 结构体字段按需持有具体依赖：
/// - [`PathMatcher`] — 路径分类（一次计算，生命周期共享）
/// - [`Router`] — 前缀路由表（前缀 → upstream_name → LB），一次匹配即得上游
/// - [`JwtVerifier`] — JWT 密码学验签 + jti 黑名单
/// - [`TokenRefresher`] — HTTP 静默续签 + Redis 去重
/// - `upstream_oauth` — 按 upstream name 排序的 OAuth Client 配置列表
/// - `oidc_provider_upstream` — OIDC Provider 的 upstream nodes（用于 /token 调用）
///
/// 限流器为模块级函数 [`crate::rate_limiter::check`]，无需注入。
#[derive(Debug)]
pub struct Gateway {
    path_matcher: PathMatcher,
    router: Router,
    jwt_verifier: JwtVerifier,
    token_refresher: TokenRefresher,
    /// 按 upstream name 排序的 OAuth Client 配置（name 长度降序，与 router 一致）
    upstream_oauth: Vec<(String, Option<OAuthConfig>)>,
    /// OIDC Provider 的 upstream name（oidc_provider = true 的条目）
    oidc_provider_name: String,
    /// OIDC Provider 的上游地址列表（用于 POST /token 等内部调用）
    oidc_provider_upstream: Arc<Upstreams>,
    /// 与 Portal 共享的 HMAC 密钥（Option 表示未启用 HMAC 签名）
    gateway_shared_secret: Option<String>,
    /// 内部上游请求协议（http/https）
    upstream_scheme: String,
}

impl Gateway {
    /// 创建网关实例。
    ///
    /// # Examples
    ///
    /// ```ignore
    /// # use std::sync::Arc;
    /// # use gateway::gateway::Gateway;
    /// # use gateway::router::Router;
    /// # use gateway::path_matcher::PathMatcher;
    /// # use gateway::auth::{JwtVerifier, TokenRefresher};
    /// # use gateway::config::Upstreams;
    /// # use gateway::jwks::JwksCache;
    /// # use pingora_load_balancing::LoadBalancer;
    /// let jwks = Arc::new(JwksCache::new());
    /// let ups = Arc::new(Upstreams::from_config("127.0.0.1:4100"));
    /// let lb = Arc::new(LoadBalancer::try_from_iter(ups.iter()).unwrap());
    /// let router = Router::new(vec![("/".to_string(), lb)]);
    /// let gw = Gateway::new(
    ///     PathMatcher::default(),
    ///     router,
    ///     JwtVerifier::new(Arc::clone(&jwks)),
    ///     TokenRefresher::new(Arc::clone(&jwks), Arc::clone(&ups)),
    /// );
    /// ```
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        path_matcher: PathMatcher,
        router: Router,
        jwt_verifier: JwtVerifier,
        token_refresher: TokenRefresher,
        mut upstream_oauth: Vec<(String, Option<OAuthConfig>)>,
        oidc_provider_name: String,
        oidc_provider_upstream: Arc<Upstreams>,
        gateway_shared_secret: Option<String>,
        upstream_scheme: String,
    ) -> Self {
        upstream_oauth.sort_by(|a, b| b.0.len().cmp(&a.0.len()));

        // 初始化全局上游协议（供 refresh/jwks 等模块使用）
        let _ = UPSTREAM_SCHEME.set(upstream_scheme.clone());

        Self {
            path_matcher,
            router,
            jwt_verifier,
            token_refresher,
            upstream_oauth,
            oidc_provider_name,
            oidc_provider_upstream,
            gateway_shared_secret,
            upstream_scheme,
        }
    }

    /// 按请求路径解析对应的 OAuth 配置，返回 `(upstream_name, Option<&OAuthConfig>)`。
    fn resolve_oauth<'a>(&'a self, path: &str) -> (&'a str, Option<&'a OAuthConfig>) {
        for (name, oauth) in self.upstream_oauth.iter() {
            if path.starts_with(name.as_str()) {
                return (name, oauth.as_ref());
            }
        }
        let default_name: &str = &self.upstream_oauth[0].0;
        (default_name, self.upstream_oauth[0].1.as_ref())
    }

    /// 无 JWT 页面导航 → 生成 PKCE + Cookie → 302 /authorize
    async fn oauth_authorize_redirect(
        &self,
        session: &mut Session,
        oauth: &OAuthConfig,
        return_to: &str,
    ) -> Result<bool> {
        let host = get_host(session);

        let state = oauth::build_oauth_state(oauth, host, return_to);
        let secure = is_secure_host(host);
        let auth_url = format!(
            "https://{}/api/auth/oauth2/authorize?\
            response_type=code&client_id={}&redirect_uri={}&\
            scope=openid+profile+email+offline_access&code_challenge={}&\
            code_challenge_method=S256&state={}&nonce={}",
            host,
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

    /// 内部调用 OIDC Provider 的 POST /api/auth/oauth2/token 进行 code→token 交换
    async fn do_token_exchange(
        &self,
        code: &str,
        code_verifier: &str,
        client_id: &str,
        client_secret: &str,
        redirect_uri: &str,
    ) -> Result<TokenExchangeResult> {
        // 从 OIDC Provider upstream 选择一个节点（启动期已保证非空，见 main.rs）
        let node = self.oidc_provider_upstream.iter().next().ok_or_else(|| {
            Error::explain(
                ErrorType::HTTPStatus(502),
                "OIDC Provider 无可用节点，无法执行 Token 交换".to_string(),
            )
        })?;
        let token_url = format!("{}://{node}/api/auth/oauth2/token", self.upstream_scheme);

        let body = oauth::build_token_exchange_body(
            code,
            code_verifier,
            client_id,
            client_secret,
            redirect_uri,
        );
        let resp = crate::http::HTTP_CLIENT
            .post(&token_url)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                Error::explain(ErrorType::HTTPStatus(502), format!("Token 端点不可达: {e}"))
            })?;

        if !resp.status().is_success() {
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

    /// OAuth callback 拦截：完整复制 Portal callback 逻辑（CSRF state + nonce + cookie 清除）
    async fn handle_oauth_callback(
        &self,
        session: &mut Session,
        oauth: &OAuthConfig,
        cookie_header: &Option<String>,
        code: &str,
        state_param: &str,
        upstream_name: &str,
    ) -> Result<bool> {
        let host = get_host(session);
        let ck = match cookie_header.as_deref() {
            Some(c) => c,
            None => {
                warn!("OAuth callback 缺少 Cookie");
                session
                    .respond_302_with_cookies("/login?error=invalid_state", &[])
                    .await?;
                return Ok(true);
            }
        };

        // ① CSRF state 校验（Cookie ↔ Query）
        let cookie_state = oauth::extract_oauth_state(ck);
        if cookie_state != Some(state_param) {
            warn!(
                "OAuth callback CSRF state 不匹配: cookie={:?} query={}",
                cookie_state, state_param
            );
            session
                .respond_302_with_cookies("/login?error=csrf_mismatch", &[])
                .await?;
            return Ok(true);
        }

        // ② PKCE code_verifier
        let Some(verifier) = oauth::extract_pkce_verifier(ck) else {
            warn!("OAuth callback 缺少 pkce_verifier");
            session
                .respond_302_with_cookies("/login?error=invalid_state", &[])
                .await?;
            return Ok(true);
        };

        // ③ nonce
        let cookie_nonce = oauth::extract_oauth_nonce(ck);

        // ④ return_to（同源消毒，防开放重定向）
        let return_to = oauth::extract_return_to(ck)
            .and_then(oauth::safe_redirect_path)
            .unwrap_or_else(|| "/".to_string());

        // ⑤ POST /token（code_verifier 为独立 body 字段）
        let Some(ref secret) = oauth.client_secret else {
            return Ok(false);
        };

        let redirect_uri = format!(
            "{}://{}{}",
            if is_secure_host(host) {
                "https"
            } else {
                "http"
            },
            host,
            oauth.callback_path,
        );

        let tokens = match self
            .do_token_exchange(code, verifier, &oauth.client_id, secret, &redirect_uri)
            .await
        {
            Ok(t) => t,
            Err(e) => {
                warn!("Token 交换失败: {:?}", e);
                session
                    .respond_302_with_cookies("/login?error=token_exchange_failed", &[])
                    .await?;
                return Ok(true);
            }
        };

        // ⑥ nonce 校验（id_token.nonce ↔ Cookie.oauth_nonce）
        if let Some(nonce) = cookie_nonce
            && let Some(ref id_token) = tokens.id_token
        {
            let id_nonce = oauth::decode_id_token_nonce(id_token);
            if id_nonce.as_deref() != Some(nonce) {
                warn!("OAuth callback nonce 不匹配");
                session
                    .respond_302_with_cookies("/login?error=nonce_mismatch", &[])
                    .await?;
                return Ok(true);
            }
        }

        // ⑦ Set-Cookie: portal_jwt_token + portal_refresh_token
        let secure = is_secure_host(host);
        let session_cookies = oauth::build_session_cookies(&tokens.access, &tokens.refresh, secure);
        let clear_cookies = oauth::build_clear_oauth_cookies(secure);

        info!(
            "OAuth callback 完成: upstream={}, return_to={}",
            upstream_name, return_to
        );
        session
            .respond_302_with_cookies(&return_to, &[session_cookies, clear_cookies].concat())
            .await?;
        Ok(true)
    }

    /// 根据 ctx 重写发往上游的 Cookie：微服务剥离全部，受保护路径剥离 RT 并替换 AT。
    fn rewrite_upstream_cookies(&self, upstream_request: &mut RequestHeader, ctx: &GatewayCtx) {
        match ctx.path_class {
            // 微服务路由：移除全部 Cookie，避免身份信息泄露给内网后端
            PathClass::Microservice => {
                upstream_request.remove_header("cookie");
            }
            // 受保护业务路径：剥离 RT，必要时替换 AT
            PathClass::Protected => {
                let mut cookie_str = String::new();
                for cookie_val in upstream_request.headers.get_all("cookie").iter() {
                    if let Ok(h) = cookie_val.to_str() {
                        if !cookie_str.is_empty() {
                            cookie_str.push_str("; ");
                        }
                        cookie_str.push_str(h);
                    }
                }

                if cookie_str.is_empty() {
                    return;
                }

                let mut new_cookie =
                    cookie::remove_from_header(&cookie_str, cookie::REFRESH_COOKIE);
                if let Some(ref new_tokens) = ctx.refreshed_tokens {
                    new_cookie = cookie::replace_in_header(
                        &new_cookie,
                        cookie::ACCESS_COOKIE,
                        &new_tokens.access,
                    );
                }

                upstream_request.remove_header("cookie");
                if let Err(e) = upstream_request.insert_header("cookie", new_cookie) {
                    warn!("重写上游 Cookie 失败: {:?}", e);
                }
            }
            // 静态 / 公开路径：Cookie 透传，不做修改
            PathClass::Static | PathClass::Public => {}
        }
    }
}

#[async_trait]
impl ProxyHttp for Gateway {
    type CTX = GatewayCtx;

    fn new_ctx(&self) -> Self::CTX {
        GatewayCtx::default()
    }

    async fn upstream_peer(
        &self,
        session: &mut Session,
        _ctx: &mut Self::CTX,
    ) -> Result<Box<HttpPeer>> {
        let path = session.req_header().uri.path();
        let (name, lb) = self.router.resolve(path);
        let host = get_host(session);
        debug!(
            "接收代理请求，Host: {}，路径: {} → upstream={}",
            host, path, name
        );

        let peer = lb.select(b"", UPSTREAM_SELECT_WEIGHT).ok_or_else(|| {
            Error::explain(
                ErrorType::HTTPStatus(502),
                format!("gateway: upstream \"{}\" 无可用节点", name),
            )
        })?;
        debug!("路由至 upstream \"{}\": {:?}", name, peer);
        let http_peer = HttpPeer::new(peer, false, host.to_string());
        Ok(Box::new(http_peer))
    }

    async fn request_filter(&self, session: &mut Session, ctx: &mut Self::CTX) -> Result<bool> {
        crate::metrics::inc_requests();

        // —— 提取所有不可变数据（之后 session 仅作 mut 操作）——
        let path = session.req_header().uri.path().to_owned();
        let query = session.req_header().uri.query().unwrap_or("").to_owned();
        let cookie_header = cookie::collapse_cookie_header(session.req_header());
        let is_html_nav = is_html_page_navigation(session.req_header());

        // 1. 进行路径分类
        ctx.path_class = self.path_matcher.classify(&path);

        // 2. 静态资源直接快速放行（无需限流、鉴权）
        if ctx.path_class == PathClass::Static {
            return Ok(false);
        }

        // 3. 限流校验
        if crate::rate_limiter::check(session).await? {
            return Ok(true);
        }

        // 4. 按路径解析当前请求所属 upstream 的 OAuth 配置
        let (upstream_name, oauth_config) = self.resolve_oauth(&path);

        // 5. OAuth callback 拦截 — 仅对非 OIDC Provider 的下游 upstream 生效。
        //    Portal（oidc_provider = true）自有 callback，Gateway 不透传代劳。
        if let Some(oauth) = oauth_config
            && upstream_name != self.oidc_provider_name
        {
            let is_callback = path == oauth.callback_path
                || path.starts_with(&format!("{}/", oauth.callback_path));
            if is_callback {
                let code = query_param(&query, "code");
                let state = query_param(&query, "state");
                if let (Some(code), Some(state)) = (code, state) {
                    if oauth.client_secret.is_some() {
                        return self
                            .handle_oauth_callback(
                                session,
                                oauth,
                                &cookie_header,
                                code,
                                state,
                                upstream_name,
                            )
                            .await;
                    }
                    if let Some(ref ck) = cookie_header {
                        ctx.oauth_passthrough_verifier =
                            oauth::extract_pkce_verifier(ck).map(String::from);
                    }
                }
            }
        }

        // 6. 白名单公开路由跳过鉴权（callback 已在前一步拦截，此处正常放行非 callback 路径）
        if ctx.path_class == PathClass::Public {
            return Ok(false);
        }

        // 7. 无 JWT → OAuth PKCE redirect or 401
        if let Some(oauth) = oauth_config {
            let has_jwt = cookie_header
                .as_deref()
                .and_then(|h| cookie::extract_from_header(h, cookie::ACCESS_COOKIE))
                .is_some();
            if !has_jwt {
                if is_html_nav {
                    return self.oauth_authorize_redirect(session, oauth, &path).await;
                }
                // 无 JWT 的 API/RSC 请求 → 401
                info!("未授权 API/RSC 请求 → 401 (upstream={})", upstream_name);
                session.respond_401().await?;
                crate::metrics::inc_auth_failures();
                return Ok(true);
            }
        }

        // 8. 鉴权与静默续签校验
        if crate::authenticate::check(session, ctx, &self.jwt_verifier, &self.token_refresher)
            .await?
        {
            return Ok(true);
        }

        Ok(false)
    }

    async fn upstream_request_filter(
        &self,
        session: &mut Session,
        upstream_request: &mut RequestHeader,
        ctx: &mut Self::CTX,
    ) -> Result<()> {
        let _ = upstream_request.remove_header("X-Forwarded-Proto");
        upstream_request.insert_header("X-Forwarded-Proto", "https")?;
        if let Some(host) = session.get_header("Host") {
            let _ = upstream_request.remove_header("Host");
            upstream_request.insert_header("Host", host)?;
            let _ = upstream_request.remove_header("X-Forwarded-Host");
            upstream_request.insert_header("X-Forwarded-Host", host)?;
        }

        // 零信任前置清洗：无条件剥离客户端可能伪造的所有身份相关头
        // （Authorization / X-User-* / X-Roles / X-Permissions / X-Client-*），
        // 再由下方按验签结果权威注入。下游收到的身份信息 100% 来自 gateway。
        strip_identity_headers(upstream_request);

        // OAuth callback 透传模式：注入 X-OAuth-Code-Verifier header
        // （无 client_secret 的 upstream，Gateway 仅生成 PKCE，由下游自行换 token）
        if let Some(ref verifier) = ctx.oauth_passthrough_verifier {
            let _ = upstream_request.insert_header("X-OAuth-Code-Verifier", verifier.as_str());
        }

        if let Some(id) = &ctx.identity {
            upstream_request.insert_header("Authorization", id.auth_header.as_str())?;
            upstream_request.insert_header("X-User-Id", id.user_id.as_str())?;
            upstream_request.insert_header("X-User-Jti", id.user_jti.as_str())?;

            // HMAC 签名：Gateway 用共享密钥对 (timestamp + userId + jti) 签名，
            // Portal 端验证此签名以确认请求确实来自受信任的 Gateway（替代 IP 白名单）。
            if let Some(ref secret) = self.gateway_shared_secret {
                let ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .expect("系统时钟异常：当前时间早于 Unix epoch")
                    .as_secs()
                    .to_string();
                let payload = format!("{}:{}:{}", ts, id.user_id, id.user_jti);
                let sig = compute_hmac_sha256_hex(secret, &payload);
                upstream_request.insert_header("X-Gateway-Timestamp", ts.as_str())?;
                upstream_request.insert_header("X-Gateway-Signature", sig.as_str())?;
            }
        }
        insert_opt_header(upstream_request, "X-Client-IP", session.client_ip())?;
        insert_opt_header(
            upstream_request,
            "X-Client-UA",
            header_str(session, "User-Agent"),
        )?;

        // 按路径分类重写上行 Cookie
        self.rewrite_upstream_cookies(upstream_request, ctx);

        Ok(())
    }

    /// 下行响应过滤：若在 request_filter 中完成了续签，则将新 Token 以 Set-Cookie 下发给浏览器
    async fn response_filter(
        &self,
        session: &mut Session,
        upstream_response: &mut ResponseHeader,
        ctx: &mut Self::CTX,
    ) -> Result<()> {
        let Some(ref new_tokens) = ctx.refreshed_tokens else {
            return Ok(());
        };

        let host = get_host(session);
        let secure = is_secure_host(host);

        for cookie in oauth::build_session_cookies(&new_tokens.access, &new_tokens.refresh, secure)
        {
            upstream_response.append_header("Set-Cookie", cookie.as_str())?;
        }

        tracing::info!(
            "下行注入续签 Set-Cookie: sub={:?}",
            ctx.identity.as_ref().map(|i| &i.user_id)
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_identity_header_strips_known_and_unknown_x_headers() {
        // 已知身份头：剥离
        assert!(is_identity_header("authorization"));
        assert!(is_identity_header("x-user-id"));
        assert!(is_identity_header("x-user-jti"));
        assert!(is_identity_header("x-user-name"));
        assert!(is_identity_header("x-roles"));
        assert!(is_identity_header("x-permissions"));
        assert!(is_identity_header("x-client-ip"));
        assert!(is_identity_header("x-client-ua"));

        // 黑名单兜底的核心价值：未来可能出现的身份头也默认剥离
        assert!(is_identity_header("x-auth-token"));
        assert!(is_identity_header("x-session-id"));
        assert!(is_identity_header("x-token"));
        assert!(is_identity_header("x-admin"));
        assert!(is_identity_header("x-is-admin"));
    }

    #[test]
    fn is_identity_header_preserves_proxy_and_business_headers() {
        // 代理标准头：保留（显式放行清单）
        assert!(!is_identity_header("x-forwarded-for"));
        assert!(!is_identity_header("x-forwarded-host"));
        assert!(!is_identity_header("x-forwarded-proto"));
        assert!(!is_identity_header("x-request-id"));
        assert!(!is_identity_header("x-correlation-id"));
        assert!(!is_identity_header("x-real-ip"));

        // 非 X- 业务头：保留
        assert!(!is_identity_header("accept"));
        assert!(!is_identity_header("cookie"));
        assert!(!is_identity_header("host"));
        assert!(!is_identity_header("content-type"));
    }

    /// 构造一个带若干伪造身份头 + 代理标准头的请求，验证 strip 后仅保留放行头
    #[test]
    fn strip_identity_headers_removes_forged_but_keeps_proxy_headers() {
        let mut req = RequestHeader::build("GET", b"/", Some(64)).unwrap();
        // 客户端伪造的身份头（含黑名单兜底覆盖的未知变体）
        req.insert_header("X-User-Id", "forged-admin").unwrap();
        req.insert_header("X-Roles", "admin").unwrap();
        req.insert_header("Authorization", "Bearer forged").unwrap();
        req.insert_header("X-Client-IP", "forged-ip").unwrap();
        req.insert_header("X-Auth-Token", "forged-token").unwrap();
        req.insert_header("X-Session-Id", "forged-session").unwrap();
        // 应保留的头（代理标准 + 业务头）
        req.insert_header("Accept", "text/html").unwrap();
        req.insert_header("X-Forwarded-For", "10.0.0.1").unwrap();
        req.insert_header("X-Request-Id", "trace-123").unwrap();
        req.insert_header("X-Real-IP", "203.0.113.5").unwrap();

        strip_identity_headers(&mut req);

        // 伪造身份头已剥离（含黑名单兜底的 X-Auth-Token / X-Session-Id）
        assert!(
            req.headers.get("x-user-id").is_none(),
            "X-User-Id 必须被剥离"
        );
        assert!(req.headers.get("x-roles").is_none(), "X-Roles 必须被剥离");
        assert!(
            req.headers.get("authorization").is_none(),
            "Authorization 必须被剥离"
        );
        assert!(
            req.headers.get("x-client-ip").is_none(),
            "X-Client-IP 必须被剥离"
        );
        assert!(
            req.headers.get("x-auth-token").is_none(),
            "X-Auth-Token 必须被剥离（黑名单兜底）"
        );
        assert!(
            req.headers.get("x-session-id").is_none(),
            "X-Session-Id 必须被剥离（黑名单兜底）"
        );
        // 代理标准头 + 业务头保留
        assert!(req.headers.get("accept").is_some(), "Accept 不应被剥离");
        assert!(
            req.headers.get("x-forwarded-for").is_some(),
            "X-Forwarded-For 是代理标准头，不应被剥离"
        );
        assert!(
            req.headers.get("x-request-id").is_some(),
            "X-Request-Id 是链路追踪头，不应被剥离"
        );
        assert!(
            req.headers.get("x-real-ip").is_some(),
            "X-Real-IP 是代理客户端 IP 头，不应被剥离"
        );
    }
}
