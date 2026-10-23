use async_trait::async_trait;
use bytes::Bytes;
use pingora_core::prelude::*;
use pingora_http::{RequestHeader, ResponseHeader, Version};
use pingora_proxy::{ProxyHttp, Session};
use std::net::IpAddr;
use std::sync::Arc;
use tracing::{debug, warn};

use crate::auth::{AuthDecision, JwtVerifier, RefreshedTokens, TokenRefresher};
use crate::config::{OAuthConfig, RateLimitConfig, Upstreams};
use crate::cookie;
use crate::http::{SessionExt, hmac_sha256_hex, is_html_page_navigation};
use crate::jwks::JwksCache;
use crate::oauth;
use crate::path_matcher::{PathClass, PathMatcher};
use crate::router::Router;

/// Pingora `LoadBalancer::select` 的第二参数为选择输入的哈希键；
/// 传 `b""` 表示纯轮询（不做一致性哈希），256 为保留的总权重占位。
///
/// 见 pingora-load-balancing 0.9 `select(&self, key: &[u8], total_weight: usize)`。
const UPSTREAM_SELECT_WEIGHT: usize = 256;
const METRICS_PATH: &str = "/__gateway/metrics";
const METRICS_KEY_HEADER: &str = "X-Gateway-Metrics-Key";
/// 网关自身存活探针路径（不经过上游 Portal / 不触发 OAuth 链路）。
///
/// 负载均衡器/K8s/部署脚本可高频探测，避免把 Portal 健康检查当成网关存活探针：
/// 上游抖动时健康检查不应把整个 Gateway 判死。只返回 `ok`（liveness），不承诺上游可用。
const HEALTH_PATH: &str = "/healthz";

/// 是否为网关存活探针路径（纯函数，便于测试路径匹配规则）
fn is_health_path(path: &str) -> bool {
    path == HEALTH_PATH
}

/// metrics 端点令牌选择（H-D-10，纯函数便于测试）。
///
/// 独立 `metrics_token` 优先；未配置时回退 `gateway_shared_secret`，保证既有部署
/// 的抓取配置不改也能继续工作。返回值借用调用方，零分配。
fn metrics_secret<'a>(
    metrics_token: Option<&'a str>,
    gateway_shared_secret: Option<&'a str>,
) -> Option<&'a str> {
    metrics_token
        .filter(|t| !t.is_empty())
        .or(gateway_shared_secret)
}

/// 验签后注入的用户 ID / jti 头名。
///
/// **跨语言契约**：Portal 侧以 `GATEWAY_HEADERS.USER_ID` / `USER_JTI` 读取（由
/// `contract_tests` 断言两端一致）。HTTP 头名大小写不敏感，这里是规范书写形态。
pub(crate) const HEADER_USER_ID: &str = "X-User-Id";
pub(crate) const HEADER_USER_JTI: &str = "X-User-Jti";

/// 从 Session 提取指定请求头的字符串值
fn header_str<'s>(session: &'s Session, name: &str) -> Option<&'s str> {
    session.get_header(name).and_then(|h| h.to_str().ok())
}

/// 从 Session 提取请求的 Host（HTTP/2 authority 优先，其次 Host 头）。
///
/// H2 的 `:authority` 伪头由 pingora 归一化进 `uri.authority()`，
/// 无需（也无法）通过 `get_header(":authority")` 读取。
///
/// 返回 `None` 表示请求确实没有 Host（HTTP/1.1 下由 [`missing_required_host`]
/// 在入口拒绝，见 H-D-05）。
fn request_host(session: &Session) -> Option<&str> {
    if let Some(auth) = session.req_header().uri.authority() {
        return Some(auth.as_str());
    }
    session.get_header("Host").and_then(|h| h.to_str().ok())
}

/// 获取请求的 Host；缺失时回退 `localhost`（仅供 `oauth_flow` 的既有构造路径使用，
/// HTTP/1.1 的缺失已由 [`missing_required_host`] 在入口拦截）。
pub(crate) fn get_host(session: &Session) -> &str {
    request_host(session).unwrap_or("localhost")
}

/// HTTP/1.1 起 Host 为必填（RFC 7230 §5.4）。缺失时 `get_host` 会回退
/// `localhost`，导致 OAuth `redirect_uri`/`Location` 指向错误主机（H-D-05），
/// 故入口直接 400 而不是继续用回退值。
fn missing_required_host(version: Version, has_host: bool) -> bool {
    version == Version::HTTP_11 && !has_host
}

/// `/healthz` 只接受 GET/HEAD（H-D-08）：存活探针无副作用语义，
/// 其它方法返回 405 而不是静默 200。
fn health_method_allowed(method: &str) -> bool {
    method == "GET" || method == "HEAD"
}

/// 200 存活探针响应头（H-D-09：Gateway 自产响应同样携带 HSTS）。
fn build_health_response_header() -> Result<ResponseHeader> {
    let mut header = ResponseHeader::build(200, None)?;
    header.insert_header("Content-Type", "text/plain; charset=utf-8")?;
    header.insert_header("Cache-Control", "no-store")?;
    crate::http::insert_hsts(&mut header)?;
    Ok(header)
}

/// 200 metrics 响应头（Prometheus 文本格式；同样携带 HSTS）。
fn build_metrics_response_header() -> Result<ResponseHeader> {
    let mut header = ResponseHeader::build(200, None)?;
    header.insert_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")?;
    crate::http::insert_hsts(&mut header)?;
    Ok(header)
}

/// 405 响应头（`/healthz` 非 GET/HEAD）：显式 `Allow` + 空 body。
fn build_health_method_not_allowed_header() -> Result<ResponseHeader> {
    let mut header = ResponseHeader::build(405, None)?;
    header.insert_header("Allow", "GET, HEAD")?;
    header.insert_header("Content-Length", "0")?;
    crate::http::insert_hsts(&mut header)?;
    Ok(header)
}

/// 解析 Vercel 权威写入的单值客户端 IP 头。
///
/// 仅接受一个合法 IP 字面量，拒绝逗号链和任意文本，避免错误配置时把
/// 未经验证的转发链直接变成限流与审计身份。
fn parse_platform_client_ip(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    value.parse::<IpAddr>().ok().map(|ip| ip.to_string())
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

/// 大小写无关的字节前缀匹配（零分配）
fn starts_with_ignore_case(name: &[u8], prefix: &[u8]) -> bool {
    name.len() >= prefix.len() && name[..prefix.len()].eq_ignore_ascii_case(prefix)
}

/// 判断某请求头是否属于「身份相关」头，应在转发前剥离。
///
/// 入参为原始头名字节（H1 保留大小写 / H2 已小写），全程
/// `eq_ignore_ascii_case` 逐段比较，不构造小写 String（零分配）。
///
/// 采用**黑名单兜底**策略：除少数显式允许的代理标准头外，
/// 所有 `X-` 前缀头 + `Authorization` + 其它认证语义头（`Forwarded`、
/// `Proxy-Authorization`）一律剥离。这样未来新增任何 `X-` 身份头
/// （如 `X-Auth-Token`、`X-Session-Id`、`X-Token`、`X-Admin` 等）都默认被剥离，
/// 无需同步维护白名单——这是零信任的核心防线，下游收到的身份信息
/// 100% 由 gateway 权威注入。
///
/// **保留**的头（非身份语义，必须显式放行）：
/// - `X-Forwarded-*`（代理链路标准头）——`X-Forwarded-For/Host/Proto` 由
///   `upstream_request_filter` 以 socket 真实地址**权威覆写**，语义安全
///   （`X-Forwarded-Prefix/Port/Server` 等其余变体当前无消费方，属 H-D-06 待收口项）
/// - `X-Request-Id` / `X-Correlation-Id`（链路追踪）
/// - `X-Real-IP`（代理客户端 IP，同样随后被权威覆写）
///
/// `X-Client-IP` / `X-Client-UA` 虽由 gateway 注入，但属身份语义，
/// 仍剥离后重新注入——不在此放行清单中。
fn is_identity_header(name: &[u8]) -> bool {
    // Authorization 始终剥离（由 gateway 按验签结果重新注入；
    // Public 机器端点例外，见 `strip_identity_headers` 的 keep 语义）
    if name.eq_ignore_ascii_case(b"authorization") {
        return true;
    }
    // RFC 7239 Forwarded / RFC 7235 Proxy-Authorization：同属认证/转发身份语义，
    // 且非 X- 前缀（H-D-06：此前会原样透传上游）。
    if name.eq_ignore_ascii_case(b"forwarded") || name.eq_ignore_ascii_case(b"proxy-authorization")
    {
        return true;
    }
    // 非 X- 前缀头不剥离（Accept、Cookie、Host 等业务头）
    if !starts_with_ignore_case(name, b"x-") {
        return false;
    }
    // 显式放行的代理标准头（非身份语义）
    if starts_with_ignore_case(name, b"x-forwarded-")
        || name.eq_ignore_ascii_case(b"x-request-id")
        || name.eq_ignore_ascii_case(b"x-correlation-id")
        || name.eq_ignore_ascii_case(b"x-real-ip")
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
/// # Public 路径的唯一例外（H-D-01）
///
/// `/api/auth/*` 等 Public 路径是 Gateway **不做验签**的端点，其中 OIDC
/// 机器端点（`userinfo` 的 `Authorization: Bearer`、`token/introspect/revoke`
/// 的 `client_secret_basic`）必须由客户端自带凭证。此前的无条件剥离使这些
/// 标准通道经唯一入口全部不可用（见 `.zcode/audit/gateway.md` H-D-01）。
/// 故 Public 路径保留客户端 `Authorization`，**其余身份头仍无条件剥离**
/// （`X-User-*`/`X-Gateway-*`/`Forwarded`/`Proxy-Authorization` 一概不放行），
/// 且 Public 不注入任何 Gateway 身份头——零信任承诺不变。
///
/// 因 Pingora `RequestHeader` 借用限制，先经只读 `map` 收集待删头名，
/// 再逐个 `remove_header`（替换语义，删除该名下所有同名头）。
/// 仅对**命中**的头才分配 owned name（典型请求 0-1 次分配）。
fn strip_identity_headers(req: &mut RequestHeader, path_class: PathClass) {
    // Public：保留客户端 Authorization（机器端点凭证）；其余分类全部剥离。
    let keep_authorization = path_class == PathClass::Public;
    let mut to_remove: Vec<String> = Vec::new();
    // map 是只读遍历（统一 H1 case 敏感 / H2 大小写无关两种表示）
    let _ = req.map(|variant, _| {
        let name: &[u8] = match variant {
            pingora_http::HeaderNameVariant::Case(cn) => cn.as_slice(),
            pingora_http::HeaderNameVariant::Titled(s) => s.as_bytes(),
        };
        if is_identity_header(name)
            && !(keep_authorization && name.eq_ignore_ascii_case(b"authorization"))
        {
            to_remove.push(String::from_utf8_lossy(name).to_ascii_lowercase());
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
    /// 当前请求命中的路由表索引（request_filter 起始处一次解析，upstream_peer 复用）
    pub route_idx: usize,
    /// 已 collapse 的 Cookie 请求头（一次拼合，鉴权与上行 Cookie 重写共享）
    pub cookie_header: Option<String>,
    /// 已验签身份（None 表示未通过验签的白名单/静态路径）
    pub identity: Option<Identity>,
    /// 续签得到的新 Token（若在本次请求中触发了静默续签）
    pub refreshed_tokens: Option<RefreshedTokens>,
    /// 当前请求的权威客户端 IP（第一跳 socket，或平台签名边界内的覆写头）
    pub client_ip: Option<String>,
}

impl GatewayCtx {}

/// 从 query string 提取指定参数值（大小写敏感，符合 RFC 6570 / OAuth 参数语义；零分配）
///
/// `pub(crate)`：OAuth callback 的**拦截判定**已移入 `oauth_flow::intercept`（纯函数，
/// 可直测），那里需要复用同一套参数提取（避免两处实现漂移）。
pub(crate) fn query_param<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    query
        .split('&')
        .find_map(|kv| kv.strip_prefix(key)?.strip_prefix('='))
}

/// Auth-SSO 去中心化安全网关 — 基于 Pingora (0.9.0 + OpenSSL)
///
/// 负责代理编排：路由分类 → 限流检查 → OAuth 2.1 Client 层（PKCE + callback 拦截）
/// → JWT 鉴权与静默续签 → 请求转发。
///
/// 结构体字段按需持有具体依赖：
/// - [`PathMatcher`] — 路径分类（一次计算，生命周期共享）
/// - [`Router`] — 单一前缀路由表（prefix → LB + OAuth 配置），一次匹配全生命周期复用
/// - [`JwtVerifier`] — JWT 密码学验签 + jti 黑名单
/// - [`TokenRefresher`] — HTTP 静默续签 + Redis 去重
/// - `oidc_provider_upstream` — OIDC Provider 的 upstream nodes（用于 /token 调用）
///
/// 限流器为模块级函数 [`crate::rate_limiter::check`]，无需注入。
/// [`Gateway::new`] 的依赖装配参数 — 13 个具名字段替代裸位置参数。
#[derive(Debug)]
pub struct GatewayDeps {
    pub path_matcher: PathMatcher,
    pub router: Router,
    pub jwt_verifier: JwtVerifier,
    pub token_refresher: TokenRefresher,
    /// OIDC Provider 的上游地址列表（用于 POST /token 等内部调用）
    pub oidc_provider_upstream: Arc<Upstreams>,
    /// 与 Portal 共享的 HMAC 密钥（None 表示未启用 HMAC 签名）
    pub gateway_shared_secret: Option<String>,
    /// metrics 端点独立令牌（None 时回退 `gateway_shared_secret`，H-D-10）
    pub metrics_token: Option<String>,
    /// 内部上游请求协议（http/https）
    pub upstream_scheme: String,
    /// HTTPS 上游的 SNI 主机名。平台内部服务通常与公网 Host 不同。
    pub upstream_server_name: Option<String>,
    /// 发往上游的 Host；`X-Forwarded-Host` 仍保留浏览器访问的公网 Host。
    pub upstream_host_header: Option<String>,
    /// 是否信任 Vercel 在容器边界覆写的 `X-Vercel-Forwarded-For`。
    pub trust_platform_client_ip: bool,
    /// 认证端点限流阈值（来自配置，env 可覆盖）
    pub rate_limit: RateLimitConfig,
    /// 网关级统一 OAuth Client 凭据（ADR-010 二期：所有 upstream 共用）
    pub oauth: OAuthConfig,
    /// JWKS 公钥缓存 — 用于获取 OIDC Discovery 元数据（callback_path 等）
    pub jwks_cache: Arc<JwksCache>,
}

#[derive(Debug)]
pub struct Gateway {
    path_matcher: PathMatcher,
    router: Router,
    jwt_verifier: JwtVerifier,
    token_refresher: TokenRefresher,
    /// OIDC Provider 的上游地址列表（用于 POST /token 等内部调用）
    ///
    /// **私有**：消费方是 `oauth_flow::TokenExchange`，它由本文件内的
    /// [`Gateway::token_exchange`] 装配——自持依赖后无需放宽可见性。
    oidc_provider_upstream: Arc<Upstreams>,
    /// 与 Portal 共享的 HMAC 密钥（Option 表示未启用 HMAC 签名）
    gateway_shared_secret: Option<String>,
    /// metrics 端点独立令牌（H-D-10；None 时回退共享密钥）
    metrics_token: Option<String>,
    /// 内部上游请求协议（http/https）
    ///
    /// **私有**：同 `oidc_provider_upstream`，经 [`Gateway::token_exchange`] 注入执行体。
    upstream_scheme: String,
    /// HTTPS 上游的 SNI 主机名。平台内部服务通常与公网 Host 不同。
    upstream_server_name: Option<String>,
    /// 发往上游的 Host；`X-Forwarded-Host` 仍保留浏览器访问的公网 Host。
    upstream_host_header: Option<String>,
    /// 是否信任 Vercel 在容器边界覆写的 `X-Vercel-Forwarded-For`。
    trust_platform_client_ip: bool,
    /// 认证端点限流阈值（来自配置，env 可覆盖）
    rate_limit: RateLimitConfig,
    /// 网关级统一 OAuth Client 凭据（ADR-010 二期：所有 upstream 共用）
    pub(crate) oauth: OAuthConfig,
    /// JWKS 公钥缓存 — 用于获取 OIDC Discovery 元数据（callback_path 等）
    pub(crate) jwks_cache: Arc<JwksCache>,
}

impl Gateway {
    /// 构造 token 交换执行体（`oauth_flow::TokenExchange`）——**唯一装配点**。
    ///
    /// 放在本文件而非 `oauth_flow.rs`：只有在这里才能合法读私有字段，
    /// 于是 `oidc_provider_upstream` / `upstream_scheme` **不必**为了跨模块访问而放宽可见性。
    pub(crate) fn token_exchange(&self) -> crate::oauth_flow::TokenExchange<'_> {
        crate::oauth_flow::TokenExchange::new(&self.oidc_provider_upstream, &self.upstream_scheme)
    }

    /// OAuth callback 路径的**唯一取值口**。
    ///
    /// `/authorize` 阶段、callback 阶段与 `request_filter` 的路径判定必须用**同一个值**——
    /// OAuth 2.1 要求两阶段 `redirect_uri` 逐字节一致；取值散落时"改一处漏一处"就会不一致。
    pub(crate) fn oauth_callback_path(&self) -> Arc<str> {
        self.jwks_cache.callback_path_or_default()
    }

    /// 创建网关实例。
    ///
    /// 依赖装配见 [`GatewayDeps`]：具名字段结构让调用点逐项自解释，
    /// 新增依赖时由编译器点名缺失字段，替代裸位置参数 + too_many_arguments 豁免。
    ///
    /// # Examples
    ///
    /// ```ignore
    /// # use std::sync::Arc;
    /// # use gateway::gateway::{Gateway, GatewayDeps};
    /// # use gateway::router::{RouteEntry, Router};
    /// # use gateway::path_matcher::PathMatcher;
    /// # use gateway::auth::{JwtVerifier, TokenRefresher};
    /// # use gateway::config::Upstreams;
    /// # use gateway::jwks::JwksCache;
    /// # use pingora_load_balancing::LoadBalancer;
    /// let jwks = Arc::new(JwksCache::new());
    /// let ups = Arc::new(Upstreams::from_config("127.0.0.1:4100"));
    /// let lb = Arc::new(LoadBalancer::try_from_iter(ups.iter()).unwrap());
    /// let router = Router::new(vec![RouteEntry {
    ///     prefix: "/".to_string(),
    ///     lb,
    /// }]);
    /// let gw = Gateway::new(GatewayDeps {
    ///     path_matcher: PathMatcher::default(),
    ///     router,
    ///     jwt_verifier: JwtVerifier::new(Arc::clone(&jwks)),
    ///     token_refresher: TokenRefresher::new(Arc::clone(&jwks), Arc::clone(&ups), "http".to_string(), None),
    ///     oidc_provider_upstream: Arc::clone(&ups),
    ///     gateway_shared_secret: None,
    ///     metrics_token: None,
    ///     upstream_scheme: "http".to_string(),
    ///     upstream_server_name: None,
    ///     upstream_host_header: None,
    ///     trust_platform_client_ip: false,
    ///     rate_limit: Default::default(),
    ///     oauth: Default::default(),
    ///     jwks_cache: jwks,
    /// });
    /// ```
    pub fn new(deps: GatewayDeps) -> Self {
        Self {
            path_matcher: deps.path_matcher,
            router: deps.router,
            jwt_verifier: deps.jwt_verifier,
            token_refresher: deps.token_refresher,
            oidc_provider_upstream: deps.oidc_provider_upstream,
            gateway_shared_secret: deps.gateway_shared_secret,
            metrics_token: deps.metrics_token,
            upstream_scheme: deps.upstream_scheme,
            upstream_server_name: deps.upstream_server_name,
            upstream_host_header: deps.upstream_host_header,
            trust_platform_client_ip: deps.trust_platform_client_ip,
            rate_limit: deps.rate_limit,
            oauth: deps.oauth,
            jwks_cache: deps.jwks_cache,
        }
    }

    /// 解析当前请求的权威客户端 IP。
    ///
    /// 自管 TLS 模式只信任 socket 对端；平台 TLS 模式只信任 Vercel
    /// 专用且由平台覆写的单值头，非法或缺失时退回 socket。
    fn client_ip(&self, session: &Session) -> Option<String> {
        if self.trust_platform_client_ip
            && let Some(ip) =
                parse_platform_client_ip(header_str(session, "X-Vercel-Forwarded-For"))
        {
            return Some(ip);
        }
        session.client_ip()
    }

    /// 无 JWT 页面导航 → 生成 PKCE + Cookie → 302 /authorize
    /// 根据 ctx 重写发往上游的 Cookie：微服务剥离全部，受保护路径剥离 RT 并替换 AT。
    ///
    /// 输入取 `ctx.cookie_header`（request_filter 起始处一次 collapse 的共享副本），
    /// 受保护路径经 [`cookie::rewrite_protected_cookies`] 单遍完成剥离 + 替换。
    fn rewrite_upstream_cookies(&self, upstream_request: &mut RequestHeader, ctx: &GatewayCtx) {
        match ctx.path_class {
            // 微服务路由：移除全部 Cookie，避免身份信息泄露给内网后端
            PathClass::Microservice => {
                upstream_request.remove_header("cookie");
            }
            // 受保护业务路径：剥离 RT，必要时替换 AT（单遍状态机）
            PathClass::Protected => {
                let Some(raw) = ctx.cookie_header.as_deref() else {
                    return;
                };
                let new_cookie = cookie::rewrite_protected_cookies(
                    raw,
                    ctx.refreshed_tokens.as_ref().map(|t| t.access.as_str()),
                );
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
        ctx: &mut Self::CTX,
    ) -> Result<Box<HttpPeer>> {
        let path = session.req_header().uri.path();
        let entry = self.router.entry(ctx.route_idx).ok_or_else(|| {
            Error::explain(
                ErrorType::HTTPStatus(502),
                format!("gateway: 路由索引 {} 越界", ctx.route_idx),
            )
        })?;
        let host = get_host(session);
        debug!(
            "接收代理请求，Host: {}，路径: {} → upstream={}",
            host, path, entry.prefix
        );

        let peer = entry
            .lb
            .select(b"", UPSTREAM_SELECT_WEIGHT)
            .ok_or_else(|| {
                Error::explain(
                    ErrorType::HTTPStatus(502),
                    format!("gateway: upstream \"{}\" 无可用节点", entry.prefix),
                )
            })?;
        debug!("路由至 upstream \"{}\": {:?}", entry.prefix, peer);
        // upstream_scheme = "https" 时主代理路径真正走 TLS（与文档承诺一致）
        let server_name = self
            .upstream_server_name
            .as_deref()
            .unwrap_or(host)
            .to_string();
        let http_peer = HttpPeer::new(peer, self.upstream_scheme == "https", server_name);
        Ok(Box::new(http_peer))
    }

    async fn request_filter(&self, session: &mut Session, ctx: &mut Self::CTX) -> Result<bool> {
        crate::metrics::inc_requests();

        let path = session.req_header().uri.path().to_owned();
        ctx.client_ip = self.client_ip(session);

        // H-D-05：HTTP/1.1 起 Host 必填（RFC 7230 §5.4）。缺失时不得回退
        // `localhost` 继续构造 OAuth redirect_uri/Location，入口直接 400。
        if missing_required_host(
            session.req_header().version,
            request_host(session).is_some(),
        ) {
            session.respond_400().await?;
            return Ok(true);
        }

        // H-D-03：分类/限流/验签全部基于原始路径，而含 dot-segment 的路径会被
        // 上游规范化成受保护端点（实测 Next.js），必须在任何决策前直接拒绝。
        if crate::path_matcher::has_dot_segments(&path) {
            warn!("拒绝含 dot-segment 的请求路径: {path}");
            session.respond_400().await?;
            return Ok(true);
        }

        // 网关自身存活探针：不查 Redis / 不访问 Portal，避免上游故障放大为网关不健康。
        if is_health_path(&path) {
            if !health_method_allowed(session.req_header().method.as_str()) {
                session
                    .write_response_header(
                        Box::new(build_health_method_not_allowed_header()?),
                        true,
                    )
                    .await?;
                return Ok(true);
            }
            let header = build_health_response_header()?;
            session
                .write_response_header(Box::new(header), false)
                .await?;
            session
                .write_response_body(Some(Bytes::from_static(b"ok\n")), true)
                .await?;
            return Ok(true);
        }

        if path == METRICS_PATH {
            // H-33 / H-D-10：比较走定长摘要 + 恒定时间累积，
            // 避免 `String ==` 的短路比较泄漏长度/前缀信息。
            // 令牌选择：独立 metrics_token 优先，未配置时回退共享密钥（兼容既有部署）。
            let metrics_secret = metrics_secret(
                self.metrics_token.as_deref(),
                self.gateway_shared_secret.as_deref(),
            );
            let authorized = metrics_secret.is_some_and(|secret| {
                header_str(session, METRICS_KEY_HEADER)
                    .is_some_and(|provided| crate::http::constant_time_eq(provided, secret))
            });
            if !authorized {
                session.respond_401().await?;
                return Ok(true);
            }
            let body = crate::metrics::render_prometheus();
            let header = build_metrics_response_header()?;
            session
                .write_response_header(Box::new(header), false)
                .await?;
            session
                .write_response_body(Some(Bytes::from(body)), true)
                .await?;
            return Ok(true);
        }

        // 0. 路由解析：入口格式校验（Host/dot-segment）已在前面 early-return 完成，
        //    此处保证后续生命周期（分类/限流/验签/转发）恒可用 ctx.route_idx
        ctx.route_idx = self.router.resolve_idx(&path);

        let query = session.req_header().uri.query().unwrap_or("").to_owned();
        ctx.cookie_header = cookie::collapse_cookie_header(session.req_header());
        let is_html_nav = is_html_page_navigation(session.req_header());

        // 1. 路径分类
        ctx.path_class = self.path_matcher.classify(&path);

        // 2. 静态资源直接放行
        if ctx.path_class == PathClass::Static {
            return Ok(false);
        }

        // 3. 限流校验
        if crate::rate_limiter::check(
            session,
            ctx.client_ip.as_deref().unwrap_or("unknown"),
            &self.rate_limit,
        )
        .await?
        {
            return Ok(true);
        }

        // 4. 网关级统一 OAuth Client 凭据（ADR-010 二期：不再随路由携带）
        let oauth_config = &self.oauth;

        // 5. OAuth callback 拦截
        //
        // 判定本身是纯函数（`oauth_flow::intercept`，可穷举测试）；
        // 本处只负责把判定结果写成响应 —— 单一职责，且"路径前缀 / error 优先级 /
        // code+state 缺一不可"这三条规则不再靠读这段内联代码才能知道。
        match crate::oauth_flow::intercept(&path, &query, self.oauth_callback_path().as_ref()) {
            crate::oauth_flow::CallbackOutcome::NotIntercepted => {}
            crate::oauth_flow::CallbackOutcome::Denied => {
                warn!("OAuth callback 携带 error 参数，重定向登录页");
                // H-35：失败分支同样清 4 个临时 OAuth Cookie（与成功路径同口径）。
                let clear_cookies =
                    crate::oauth_flow::failure_clear_cookies(self.oauth_callback_path().as_ref());
                session
                    .respond_302_with_cookies(
                        crate::oauth_flow::CALLBACK_DENIED_LOCATION,
                        &clear_cookies,
                    )
                    .await?;
                return Ok(true);
            }
            crate::oauth_flow::CallbackOutcome::Handle { code, state } => {
                return self
                    .handle_oauth_callback(
                        session,
                        oauth_config,
                        ctx.cookie_header.as_deref(),
                        &code,
                        &state,
                    )
                    .await;
            }
        }

        // 6. 白名单公开路由跳过鉴权
        if ctx.path_class == PathClass::Public {
            return Ok(false);
        }

        // 7. 鉴权与静默续签 — 统一 match 三态决策
        match crate::authenticate::check(
            session,
            ctx,
            &self.jwt_verifier,
            &self.token_refresher,
            is_html_nav,
        )
        .await?
        {
            AuthDecision::Pass => {}
            AuthDecision::Interrupted => return Ok(true),
            AuthDecision::PkceRequired => {
                // 保留 query，登录完成后完整回跳（如 /orders?page=2&sort=desc）
                let return_to = if query.is_empty() {
                    path.clone()
                } else {
                    format!("{path}?{query}")
                };
                // 若本次请求已续签（Portal 已轮换），新 Cookie 必须随这个 302 送达：
                // 丢掉它们会让浏览器继续用已被撤销的旧 RT（见 authenticate 模块头部）。
                let extra_cookies = crate::authenticate::refreshed_cookies(ctx);
                return self
                    .oauth_authorize_redirect(session, oauth_config, &return_to, &extra_cookies)
                    .await;
            }
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
        let public_host = get_host(session).to_owned();
        let upstream_host = self.upstream_host_header.as_deref().unwrap_or(&public_host);
        let _ = upstream_request.remove_header("Host");
        upstream_request.insert_header("Host", upstream_host)?;
        let _ = upstream_request.remove_header("X-Forwarded-Host");
        upstream_request.insert_header("X-Forwarded-Host", public_host)?;

        // 零信任前置清洗：剥离客户端可能伪造的所有身份相关头。
        // 唯一例外是 Public 路径的客户端 Authorization（OIDC 机器端点凭证，
        // 见 `strip_identity_headers` 文档与 H-D-01）；其余分类仍全剥离，
        // 再由下方按验签结果权威注入。下游收到的身份信息 100% 来自 gateway。
        strip_identity_headers(upstream_request, ctx.path_class);

        // A5-4 trace-id 传播：X-Request-Id 在白名单内原样透传；缺失时以
        // CSPRNG 生成，保证每条请求在 Portal 结构化日志中可全链路关联
        if upstream_request.headers.get("X-Request-Id").is_none() {
            let mut bytes = [0u8; 16];
            let _ = getrandom::fill(&mut bytes);
            let request_id: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
            upstream_request.insert_header("X-Request-Id", request_id)?;
        }

        // 权威覆写代理头：自管 TLS 取 socket；平台 TLS 仅信任 Vercel 覆写的专用头。
        // 其他入站 X-Forwarded-For / X-Real-IP 一律覆写而非透传（B2）。
        let _ = upstream_request.remove_header("X-Forwarded-For");
        let _ = upstream_request.remove_header("X-Real-IP");
        if let Some(ip) = ctx.client_ip.as_deref() {
            upstream_request.insert_header("X-Forwarded-For", ip)?;
            upstream_request.insert_header("X-Real-IP", ip)?;
            upstream_request.insert_header("X-Client-IP", ip)?;
        }
        insert_opt_header(
            upstream_request,
            "X-Client-UA",
            header_str(session, "User-Agent"),
        )?;

        // 按路径分类重写上行 Cookie
        self.rewrite_upstream_cookies(upstream_request, ctx);

        if let Some(id) = &ctx.identity {
            upstream_request.insert_header("Authorization", id.auth_header.as_str())?;
            upstream_request.insert_header(HEADER_USER_ID, id.user_id.as_str())?;
            upstream_request.insert_header(HEADER_USER_JTI, id.user_jti.as_str())?;

            // HMAC 签名：Gateway 用共享密钥对 (timestamp + userId + jti) 签名，
            // Portal 端验证此签名以确认请求确实来自受信任的 Gateway（替代 IP 白名单）。
            // 时钟异常时仅跳过 HMAC 签名，不影响身份头注入（身份与签名解耦）。
            if let Some(ref secret) = self.gateway_shared_secret {
                if let Some(d) = crate::http::unix_secs() {
                    let ts = d.to_string();
                    let payload = format!("{}:{}:{}", ts, id.user_id, id.user_jti);
                    match hmac_sha256_hex(secret, &payload) {
                        Some(sig) => {
                            upstream_request.insert_header("X-Gateway-Timestamp", ts.as_str())?;
                            upstream_request.insert_header("X-Gateway-Signature", sig.as_str())?;
                        }
                        None => {
                            warn!("计算 HMAC 签名失败，跳过");
                        }
                    }
                } else {
                    warn!("系统时钟异常，跳过 HMAC 签名");
                }
            }
        }

        Ok(())
    }

    /// 下行响应过滤：若在 request_filter 中完成了续签，则将新 Token 以 Set-Cookie 下发给浏览器
    async fn response_filter(
        &self,
        _session: &mut Session,
        upstream_response: &mut ResponseHeader,
        ctx: &mut Self::CTX,
    ) -> Result<()> {
        // H-D-09：TLS 在 Gateway 终结，HSTS 必须覆盖**所有经代理的上游响应**
        // （上游未设置时补齐；已设置时不覆盖，避免与 Portal 的策略冲突）。
        crate::http::insert_hsts(upstream_response)?;

        let Some(ref new_tokens) = ctx.refreshed_tokens else {
            return Ok(());
        };

        // 续签后的浏览器会话 Cookie 同样由 HTTPS Gateway 下发，必须保持 Secure。
        let secure = true;

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
    #[test]
    fn health_probe_is_exact_path_only() {
        assert!(super::is_health_path("/healthz"));
        assert!(!super::is_health_path("/healthz/"));
        assert!(!super::is_health_path("/healthz?x=1"));
        assert!(!super::is_health_path("/health"));
        assert!(!super::is_health_path("/api/health"));
    }

    // ── H-D-10：metrics 独立令牌优先、未配置回退共享密钥 ─────────────
    #[test]
    fn metrics_secret_prefers_dedicated_token_and_falls_back_to_shared() {
        // 独立令牌优先：抓取器凭证与 HMAC 签名密钥分离
        assert_eq!(
            metrics_secret(Some("metrics-token-0123456789"), Some("shared-secret")),
            Some("metrics-token-0123456789")
        );
        // 未配置 → 回退共享密钥（既有部署不改抓取配置也能继续工作）
        assert_eq!(
            metrics_secret(None, Some("shared-secret")),
            Some("shared-secret")
        );
        // 空字符串视为未配置（配置层会拒绝 <16 的令牌，这里防御性兜底）
        assert_eq!(
            metrics_secret(Some(""), Some("shared-secret")),
            Some("shared-secret")
        );
        // 两者都没有 → 未认证（fail-close：metrics 返回 401）
        assert_eq!(metrics_secret(None, None), None);
    }

    use super::*;

    fn header_str_value<'a>(header: &'a ResponseHeader, name: &str) -> Option<&'a str> {
        header
            .headers
            .get(name)
            .and_then(|value| value.to_str().ok())
    }

    // ── H-D-05：HTTP/1.1 起 Host 必填（RFC 7230 §5.4）─────────────
    #[test]
    fn missing_required_host_only_for_http11_without_host() {
        assert!(
            missing_required_host(Version::HTTP_11, false),
            "HTTP/1.1 无 Host 必须在入口拒绝"
        );
        assert!(!missing_required_host(Version::HTTP_11, true));
        // HTTP/1.0 允许省略 Host；HTTP/2 缺 :authority 由协议层/解析器处理
        assert!(!missing_required_host(Version::HTTP_10, false));
        assert!(!missing_required_host(Version::HTTP_2, false));
    }

    // ── H-D-08：/healthz 仅 GET/HEAD ─────────────────────────────
    #[test]
    fn health_method_allows_only_get_and_head() {
        for method in ["GET", "HEAD"] {
            assert!(health_method_allowed(method), "{method} 应允许");
        }
        for method in ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "get"] {
            assert!(!health_method_allowed(method), "{method} 应拒绝");
        }
    }

    #[test]
    fn health_method_not_allowed_header_is_405_with_allow_and_hsts() {
        let header = build_health_method_not_allowed_header().unwrap();

        assert_eq!(header.status.as_u16(), 405);
        assert_eq!(header_str_value(&header, "allow"), Some("GET, HEAD"));
        assert_eq!(header_str_value(&header, "content-length"), Some("0"));
        assert_eq!(
            header_str_value(&header, crate::http::HSTS_HEADER),
            Some(crate::http::HSTS_VALUE)
        );
    }

    // ── H-D-09：Gateway 自产响应携带 HSTS ──────────────────────────
    #[test]
    fn health_and_metrics_headers_carry_hsts() {
        let health = build_health_response_header().unwrap();
        assert_eq!(health.status.as_u16(), 200);
        assert_eq!(
            header_str_value(&health, "content-type"),
            Some("text/plain; charset=utf-8")
        );
        assert_eq!(
            header_str_value(&health, crate::http::HSTS_HEADER),
            Some(crate::http::HSTS_VALUE)
        );

        let metrics = build_metrics_response_header().unwrap();
        assert_eq!(metrics.status.as_u16(), 200);
        assert_eq!(
            header_str_value(&metrics, "content-type"),
            Some("text/plain; version=0.0.4; charset=utf-8")
        );
        assert_eq!(
            header_str_value(&metrics, crate::http::HSTS_HEADER),
            Some(crate::http::HSTS_VALUE)
        );
    }

    #[test]
    fn is_identity_header_strips_known_and_unknown_x_headers() {
        // 已知身份头：剥离
        assert!(is_identity_header(b"authorization"));
        assert!(is_identity_header(b"x-user-id"));
        assert!(is_identity_header(b"x-user-jti"));
        assert!(is_identity_header(b"x-user-name"));
        assert!(is_identity_header(b"x-roles"));
        assert!(is_identity_header(b"x-permissions"));
        assert!(is_identity_header(b"x-client-ip"));
        assert!(is_identity_header(b"x-client-ua"));

        // 黑名单兜底的核心价值：未来可能出现的身份头也默认剥离
        assert!(is_identity_header(b"x-auth-token"));
        assert!(is_identity_header(b"x-session-id"));
        assert!(is_identity_header(b"x-token"));
        assert!(is_identity_header(b"x-admin"));
        assert!(is_identity_header(b"x-is-admin"));

        // 大小写无关（H1 原始头名保留大小写）
        assert!(is_identity_header(b"Authorization"));
        assert!(is_identity_header(b"X-User-Id"));

        // H-D-06：认证/转发语义的非 X- 头同样必须剥离
        assert!(is_identity_header(b"Forwarded"));
        assert!(is_identity_header(b"forwarded"));
        assert!(is_identity_header(b"Proxy-Authorization"));
        assert!(is_identity_header(b"proxy-authorization"));
    }

    #[test]
    fn is_identity_header_preserves_proxy_and_business_headers() {
        // 代理标准头：保留（显式放行清单，随后被权威覆写）
        assert!(!is_identity_header(b"x-forwarded-for"));
        assert!(!is_identity_header(b"x-forwarded-host"));
        assert!(!is_identity_header(b"x-forwarded-proto"));
        assert!(!is_identity_header(b"x-request-id"));
        assert!(!is_identity_header(b"x-correlation-id"));
        assert!(!is_identity_header(b"x-real-ip"));
        assert!(!is_identity_header(b"X-Forwarded-For"));

        // 非 X- 业务头：保留
        assert!(!is_identity_header(b"accept"));
        assert!(!is_identity_header(b"cookie"));
        assert!(!is_identity_header(b"host"));
        assert!(!is_identity_header(b"content-type"));
    }

    /// 构造一个带若干伪造身份头 + 代理标准头的请求
    fn forged_request() -> RequestHeader {
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
        req.insert_header("Cookie", "sid=abc").unwrap();
        req.insert_header("X-Forwarded-For", "10.0.0.1").unwrap();
        req.insert_header("X-Request-Id", "trace-123").unwrap();
        req.insert_header("X-Real-IP", "203.0.113.5").unwrap();
        req
    }

    /// 构造一个带若干伪造身份头 + 代理标准头的请求，验证 Protected 路径 strip 后仅保留放行头
    #[test]
    fn strip_identity_headers_protected_removes_forged_and_authorization() {
        let mut req = forged_request();

        strip_identity_headers(&mut req, PathClass::Protected);

        // 伪造身份头已剥离（含黑名单兜底的 X-Auth-Token / X-Session-Id）
        assert!(
            req.headers.get("x-user-id").is_none(),
            "X-User-Id 必须被剥离"
        );
        assert!(req.headers.get("x-roles").is_none(), "X-Roles 必须被剥离");
        assert!(
            req.headers.get("authorization").is_none(),
            "Protected 路径必须剥离客户端 Authorization（由 Gateway 验签后注入）"
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
        assert!(req.headers.get("cookie").is_some(), "Cookie 不应被剥离");
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

    /// **H-D-01 核心不变量**：Public 路径下 OIDC 机器端点需要客户端自带的
    /// `Authorization`（Bearer / `client_secret_basic`），必须保留；其余身份头照旧剥离。
    #[test]
    fn strip_identity_headers_public_keeps_client_authorization_only() {
        let mut req = forged_request();
        req.insert_header("X-Gateway-Signature", "deadbeef")
            .unwrap();
        req.insert_header("Forwarded", "for=203.0.113.9").unwrap();
        req.insert_header("Proxy-Authorization", "Basic cHJveHk=")
            .unwrap();

        strip_identity_headers(&mut req, PathClass::Public);

        // 唯一放行的身份头：客户端 Authorization（值逐字节保留）
        assert_eq!(
            req.headers
                .get("authorization")
                .and_then(|v| v.to_str().ok()),
            Some("Bearer forged"),
            "Public 路径必须保留客户端 Authorization"
        );
        // 其余身份头仍无条件剥离（零信任兜底不变）
        for name in [
            "x-user-id",
            "x-user-jti",
            "x-roles",
            "x-client-ip",
            "x-auth-token",
            "x-session-id",
            "x-gateway-signature",
        ] {
            assert!(
                req.headers.get(name).is_none(),
                "Public 路径仍必须剥离 {name}"
            );
        }
        // H-D-06：RFC 7239 Forwarded / Proxy-Authorization 属认证语义，同样剥离
        assert!(
            req.headers.get("forwarded").is_none(),
            "Forwarded 必须被剥离"
        );
        assert!(
            req.headers.get("proxy-authorization").is_none(),
            "Proxy-Authorization 必须被剥离"
        );
        // 业务头 / 代理标准头不受影响
        assert!(req.headers.get("cookie").is_some(), "Cookie 不应被剥离");
        assert!(req.headers.get("accept").is_some(), "Accept 不应被剥离");
        assert!(
            req.headers.get("x-forwarded-for").is_some(),
            "X-Forwarded-For 由 Gateway 覆写，不应在此剥离"
        );
    }

    /// Public 分支的保留判定必须大小写无关（H1 原始大小写 / H2 小写两种表示）
    #[test]
    fn strip_identity_headers_public_keeps_authorization_case_insensitive() {
        for header_name in ["authorization", "Authorization", "AUTHORIZATION"] {
            let mut req = RequestHeader::build("GET", b"/", Some(64)).unwrap();
            req.insert_header(header_name, "Basic Y2xpZW50OnNlY3JldA==")
                .unwrap();
            req.insert_header("X-User-Id", "forged").unwrap();

            strip_identity_headers(&mut req, PathClass::Public);

            assert_eq!(
                req.headers
                    .get("authorization")
                    .and_then(|v| v.to_str().ok()),
                Some("Basic Y2xpZW50OnNlY3JldA=="),
                "Public 路径下 {header_name} 应保留"
            );
            assert!(req.headers.get("x-user-id").is_none());
        }
    }

    /// 多值 Authorization（H2 允许重复头）在 Public 下必须全保留、Protected 下必须全删
    #[test]
    fn strip_identity_headers_handles_multiple_authorization_values() {
        let build = || {
            let mut req = RequestHeader::build("GET", b"/", Some(64)).unwrap();
            req.append_header("authorization", "Bearer first").unwrap();
            req.append_header("authorization", "Basic second").unwrap();
            req
        };

        let mut public = build();
        strip_identity_headers(&mut public, PathClass::Public);
        let kept: Vec<&str> = public
            .headers
            .get_all("authorization")
            .iter()
            .filter_map(|v| v.to_str().ok())
            .collect();
        assert_eq!(
            kept,
            vec!["Bearer first", "Basic second"],
            "Public 路径下多值 Authorization 必须全部保序保留"
        );

        let mut protected = build();
        strip_identity_headers(&mut protected, PathClass::Protected);
        assert_eq!(
            protected.headers.get_all("authorization").iter().count(),
            0,
            "Protected 路径下多值 Authorization 必须全部剥离"
        );
    }

    #[test]
    fn query_param_is_case_sensitive_and_exact() {
        // 基本提取
        assert_eq!(query_param("code=abc&state=xyz", "code"), Some("abc"));
        assert_eq!(query_param("code=abc&state=xyz", "state"), Some("xyz"));
        // 大小写敏感（OAuth 参数名区分大小写）
        assert_eq!(query_param("CODE=abc", "code"), None);
        // 前缀 key 不误匹配（B8 回归：不做子串匹配）
        assert_eq!(query_param("barcode=1&code=2", "code"), Some("2"));
        assert_eq!(query_param("codex=1", "code"), None);
        // 空值与缺失
        assert_eq!(query_param("code=", "code"), Some(""));
        assert_eq!(query_param("", "code"), None);
        assert_eq!(
            query_param("error=access_denied", "error"),
            Some("access_denied")
        );
    }

    #[test]
    fn platform_client_ip_accepts_only_one_valid_ip_literal() {
        assert_eq!(
            parse_platform_client_ip(Some(" 203.0.113.10 ")).as_deref(),
            Some("203.0.113.10")
        );
        assert_eq!(
            parse_platform_client_ip(Some("2001:db8::1")).as_deref(),
            Some("2001:db8::1")
        );
        assert_eq!(
            parse_platform_client_ip(Some("203.0.113.10, 10.0.0.1")),
            None
        );
        assert_eq!(parse_platform_client_ip(Some("unknown")), None);
        assert_eq!(parse_platform_client_ip(None), None);
    }
}
