use async_trait::async_trait;
use pingora_core::prelude::*;
use pingora_http::{RequestHeader, ResponseHeader};
use pingora_proxy::{ProxyHttp, Session};
use tracing::{debug, warn};

use crate::auth::{
    ACCESS_TOKEN_MAX_AGE_SEC, JwtVerifier, REFRESH_TOKEN_MAX_AGE_SEC, RefreshedTokens,
    TokenRefresher,
};
use crate::cookie;
use crate::http::{SessionExt, is_secure_host};
use crate::path_matcher::{PathClass, PathMatcher};
use crate::router::Router;

/// Pingora `LoadBalancer::select` 的第二参数为选择输入的哈希键；
/// 传 `b""` 表示纯轮询（不做一致性哈希），256 为保留的总权重占位。
///
/// 见 pingora-load-balancing 0.8 `select(&self, key: &[u8], total_weight: usize)`。
const UPSTREAM_SELECT_WEIGHT: usize = 256;

/// 从 Session 提取指定请求头的字符串值
fn header_str<'s>(session: &'s Session, name: &str) -> Option<&'s str> {
    session.get_header(name).and_then(|h| h.to_str().ok())
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
        req.remove_header(name.as_str());
    }
}

/// 构造一个续签后的会话 Cookie 字符串（`Set-Cookie` 头值）。
///
/// 统一 AT/RT 两段 `format!` 的重复构造：相同属性（`Path=/; HttpOnly; SameSite=Lax`），
/// 仅 cookie 名、值、Max-Age 与 Secure 标记不同。
fn build_session_cookie(name: &str, value: &str, max_age: u64, secure: bool) -> String {
    let secure_str = if secure { "; Secure" } else { "" };
    format!("{name}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure_str}")
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

/// Auth-SSO 去中心化安全网关 — 基于 Pingora (0.8.0 + OpenSSL)
///
/// 负责代理编排：路由分类 → 限流检查 → 鉴权与静默续签 → 请求转发。
///
/// 结构体字段按需持有具体依赖：
/// - [`PathMatcher`] — 路径分类（一次计算，生命周期共享）
/// - [`Router`] — 前缀路由表（前缀 → upstream_name → LB），一次匹配即得上游
/// - [`JwtVerifier`] — JWT 密码学验签 + jti 黑名单
/// - [`TokenRefresher`] — HTTP 静默续签 + Redis 去重
///
/// 限流器为模块级函数 [`crate::rate_limiter::check`]，无需注入。
pub struct Gateway {
    /// 白名单/公开路径匹配器（鉴权决策使用，不参与路由）
    path_matcher: PathMatcher,
    /// 前缀路由表（前缀 → name → LB）
    router: Router,
    /// JWT 验签器
    jwt_verifier: JwtVerifier,
    /// Token 续签器
    token_refresher: TokenRefresher,
}

impl std::fmt::Debug for Gateway {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Gateway")
            .field("router", &self.router)
            .field("jwt_verifier", &self.jwt_verifier)
            .field("token_refresher", &self.token_refresher)
            .finish()
    }
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
    pub fn new(
        path_matcher: PathMatcher,
        router: Router,
        jwt_verifier: JwtVerifier,
        token_refresher: TokenRefresher,
    ) -> Self {
        Self {
            path_matcher,
            router,
            jwt_verifier,
            token_refresher,
        }
    }

    /// 根据 ctx 重写发往上游的 Cookie：微服务剥离全部，受保护路径剥离 RT 并替换 AT。
    fn rewrite_upstream_cookies(&self, upstream_request: &mut RequestHeader, ctx: &GatewayCtx) {
        match ctx.path_class {
            // 微服务路由：移除全部 Cookie，避免身份信息泄露给内网后端
            PathClass::Microservice => {
                upstream_request.remove_header("Cookie");
            }
            // 受保护业务路径：剥离 RT，必要时替换 AT
            PathClass::Protected => {
                let Some(cookie_str) = upstream_request
                    .headers
                    .get("Cookie")
                    .and_then(|v| v.to_str().ok())
                else {
                    return;
                };
                let mut new_cookie = cookie::remove_from_header(cookie_str, cookie::REFRESH_COOKIE);
                if let Some(ref new_tokens) = ctx.refreshed_tokens {
                    new_cookie = cookie::replace_in_header(
                        &new_cookie,
                        cookie::ACCESS_COOKIE,
                        &new_tokens.access,
                    );
                }
                if let Err(e) = upstream_request.insert_header("Cookie", new_cookie) {
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
        let host = header_str(session, "Host").unwrap_or("");
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
        Ok(Box::new(HttpPeer::new(peer, false, String::new())))
    }

    async fn request_filter(&self, session: &mut Session, ctx: &mut Self::CTX) -> Result<bool> {
        crate::metrics::inc_requests();
        let path = session.req_header().uri.path();

        // 1. 进行路径分类
        ctx.path_class = self.path_matcher.classify(path);

        // 2. 静态资源直接快速放行（无需限流、鉴权）
        if ctx.path_class == PathClass::Static {
            return Ok(false);
        }

        // 3. 限流校验
        if crate::rate_limiter::check(session).await? {
            return Ok(true);
        }

        // 4. 白名单公开路由跳过鉴权
        if ctx.path_class == PathClass::Public {
            return Ok(false);
        }

        // 5. 鉴权与静默续签校验
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
        upstream_request.insert_header("X-Forwarded-Proto", "https")?;
        if let Some(host) = session.get_header("Host") {
            upstream_request.insert_header("Host", host)?;
            upstream_request.insert_header("X-Forwarded-Host", host)?;
        }

        // 零信任前置清洗：无条件剥离客户端可能伪造的所有身份相关头
        // （Authorization / X-User-* / X-Roles / X-Permissions / X-Client-*），
        // 再由下方按验签结果权威注入。下游收到的身份信息 100% 来自 gateway。
        strip_identity_headers(upstream_request);

        // 按路径分类重写上行 Cookie
        self.rewrite_upstream_cookies(upstream_request, ctx);

        // 注入身份信息 Header：identity 三项同生共死，一起注入；
        // client_ip / client_ua 独立可选。白名单/静态路径 ctx.identity 为 None，自然 no-op。
        if let Some(id) = &ctx.identity {
            upstream_request.insert_header("Authorization", id.auth_header.as_str())?;
            upstream_request.insert_header("X-User-Id", id.user_id.as_str())?;
            upstream_request.insert_header("X-User-Jti", id.user_jti.as_str())?;
        }
        insert_opt_header(upstream_request, "X-Client-IP", session.client_ip())?;
        insert_opt_header(
            upstream_request,
            "X-Client-UA",
            header_str(session, "User-Agent"),
        )?;

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

        let host = header_str(session, "Host").unwrap_or("");
        let secure = is_secure_host(host);

        let at_cookie = build_session_cookie(
            cookie::ACCESS_COOKIE,
            &new_tokens.access,
            ACCESS_TOKEN_MAX_AGE_SEC,
            secure,
        );
        let rt_cookie = build_session_cookie(
            cookie::REFRESH_COOKIE,
            &new_tokens.refresh,
            REFRESH_TOKEN_MAX_AGE_SEC,
            secure,
        );

        upstream_response.append_header("Set-Cookie", at_cookie)?;
        upstream_response.append_header("Set-Cookie", rt_cookie)?;

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
