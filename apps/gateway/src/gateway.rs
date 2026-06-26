use std::sync::Arc;

use async_trait::async_trait;
use pingora_core::prelude::*;
use pingora_http::{RequestHeader, ResponseHeader};
use pingora_load_balancing::LoadBalancer;
use pingora_load_balancing::selection::RoundRobin;
use pingora_proxy::{ProxyHttp, Session};
use tracing::{debug, info, warn};

use crate::auth::{self, AuthService, RefreshedTokens};
use crate::cookie;
use crate::path_matcher::{PathClass, PathMatcher};
use crate::rate_limiter::RateLimiter;

/// 根据请求上下文决策鉴权失败时的响应方式：
/// — 浏览器普通页面导航 → 302 重定向至登录页
/// — API / RSC / Server Action → 401 直接拦截
fn should_redirect_to_login(method: &str, accept: &str, has_rsc: bool) -> bool {
    let is_get = method.eq_ignore_ascii_case("GET");
    let is_html = accept.contains("text/html");
    is_get && is_html && !has_rsc
}

/// 鉴权失败统一响应处理（302 重定向 或 401 拦截）
///
/// 不依赖 Gateway 状态，作为纯函数处理 HTTP 响应。
/// 返回 `Ok(true)` 表示已写回响应，调用方应据此短路。
async fn respond_auth_failure(session: &mut Session) -> Result<bool> {
    let method = session.req_header().method.as_str();
    let accept = session
        .get_header("Accept")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    let has_rsc = session.get_header("RSC").is_some() || session.get_header("rsc").is_some();

    if should_redirect_to_login(method, accept, has_rsc) {
        let path = session.req_header().uri.path();
        let mut current_url = path.to_owned();
        if let Some(query) = session.req_header().uri.query() {
            current_url.push('?');
            current_url.push_str(query);
        }
        let callback_url = urlencoding::encode(&current_url);
        let redirect_url = format!("/login?callbackUrl={}", callback_url);

        info!(
            "页面未授权 GET 导航，网关执行 302 重定向至: {}",
            redirect_url
        );
        let mut header = ResponseHeader::build(302, None)?;
        header.insert_header("Location", redirect_url)?;
        session.set_keepalive(None);
        session
            .write_response_header(Box::new(header), true)
            .await?;
        return Ok(true);
    }

    info!("接口或异步 RPC 未授权访问，网关执行 401 强拦截");
    let mut header = ResponseHeader::build(401, None)?;
    header.insert_header("WWW-Authenticate", "Bearer")?;
    session
        .write_response_header(Box::new(header), true)
        .await?;
    Ok(true)
}

/// 从 Session 提取指定请求头的字符串值
fn header_str<'s>(session: &'s Session, name: &str) -> Option<&'s str> {
    session.get_header(name).and_then(|h| h.to_str().ok())
}

/// 网关请求上下文类型，用于在代理生命周期中传递已解析的身份与分类信息
#[derive(Default, Debug)]
pub struct GatewayCtx {
    /// 当前请求的路径分类（在 request_filter 中一次计算，upstream 阶段复用）
    pub path_class: PathClass,
    /// 预格式化的 Authorization 头部值（例如 "Bearer <token>"）
    pub auth_header: Option<String>,
    /// 用户 ID（从 JWT Claims.sub 提取）
    pub user_id: Option<String>,
    /// JWT 唯一标识（从 JWT Claims.jti 提取）
    pub user_jti: Option<String>,
    /// 续签得到的新 Token（若在本次请求中触发了静默续签）
    pub refreshed_tokens: Option<RefreshedTokens>,
    /// 客户端真实 IP（从 X-Forwarded-For 提取）
    pub client_ip: Option<String>,
    /// 客户端 User-Agent
    pub client_ua: Option<String>,
}

impl GatewayCtx {
    /// 是否已通过验签（即上行应注入身份 Header）
    fn is_authenticated(&self) -> bool {
        self.auth_header.is_some()
    }
}

/// Auth-SSO 去中心化安全网关 — 基于 Pingora (0.8.0 + OpenSSL)
///
/// 负责代理编排：路由分类 → 限流 → 认证委托 → 请求转发。
/// JWT 验签、续签逻辑委托给 `AuthService`；限流由自包含的 `RateLimiter` 处理。
pub struct Gateway {
    /// Portal 上游负载均衡器
    pub portal_lb: Arc<LoadBalancer<RoundRobin>>,
    /// 认证服务（JWT 验签 + Token 续签 + jti 黑名单）
    pub auth_service: Arc<AuthService>,
    /// 公开路径匹配器
    pub path_matcher: PathMatcher,
    /// 速率限制器（内部自带 Redis + 进程内降级）
    pub limiter: Arc<RateLimiter>,
}

impl Gateway {
    /// 执行 JWT 验签与静默续签，把身份信息写入 ctx。
    ///
    /// 返回 `Ok(true)` 表示鉴权失败并已写回 302/401 响应，调用方应短路；
    /// 返回 `Ok(false)` 表示已认证（或为白名单放行路径），可继续转发。
    async fn authenticate(&self, session: &mut Session, ctx: &mut GatewayCtx) -> Result<bool> {
        let cookie_header = session.get_header("Cookie").and_then(|v| v.to_str().ok());

        let token =
            match cookie_header.and_then(|h| cookie::extract_from_header(h, "portal_jwt_token")) {
                Some(t) => t,
                None => return respond_auth_failure(session).await,
            };

        // 委托 AuthService 执行离线密码学 ES256 验签 + jti 黑名单检查
        let verified = match self.auth_service.verify_jwt(token).await {
            Some(v) => v,
            None => return respond_auth_failure(session).await,
        };

        ctx.auth_header = Some(format!("Bearer {}", token));
        ctx.user_id = Some(verified.user_id);
        ctx.user_jti = Some(verified.jti);

        // Access Token 即将过期 → 静默续签（失败不阻断，旧 AT 仍有效）
        if auth::needs_refresh(token)
            && let Some(rt) =
                cookie_header.and_then(|h| cookie::extract_from_header(h, "portal_refresh_token"))
            && let Some(new_tokens) = self
                .auth_service
                .try_refresh_token(rt, ctx.user_id.as_deref().unwrap())
                .await
        {
            // 解码新 AT 的 payload，更新 ctx 中的身份信息
            if let Some(new_claims) = auth::decode_jwt_payload(&new_tokens.access) {
                ctx.auth_header = Some(format!("Bearer {}", new_tokens.access));
                ctx.user_id = Some(new_claims.sub);
                ctx.user_jti = Some(new_claims.jti);
                ctx.refreshed_tokens = Some(new_tokens);
            }
        }

        Ok(false)
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
                let mut new_cookie = cookie::remove_from_header(cookie_str, "portal_refresh_token");
                if let Some(ref new_tokens) = ctx.refreshed_tokens {
                    new_cookie = cookie::replace_in_header(
                        &new_cookie,
                        "portal_jwt_token",
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
        let host = header_str(session, "Host").unwrap_or("");
        debug!("接收代理请求，Host: {}", host);

        let peer = self.portal_lb.select(b"", 256).ok_or_else(|| {
            Error::explain(
                ErrorType::HTTPStatus(502),
                "gateway: 无可用 Portal 上游节点，请检查配置文件中的 upstream 设置",
            )
        })?;
        debug!("路由至 Portal 上游: {:?}", peer);
        Ok(Box::new(HttpPeer::new(peer, false, "portal".to_string())))
    }

    async fn request_filter(&self, session: &mut Session, ctx: &mut Self::CTX) -> Result<bool> {
        let path = session.req_header().uri.path();

        // 0. 提取客户端 IP（优先 X-Forwarded-For）和 User-Agent
        ctx.client_ip = header_str(session, "X-Forwarded-For")
            .and_then(|s| s.split(',').next().map(|s| s.trim().to_string()));
        ctx.client_ua = header_str(session, "User-Agent").map(|s| s.to_string());

        // 1. 一次分类，贯穿后续 upstream 阶段
        ctx.path_class = self.path_matcher.classify(path);

        // 2. 静态资源：跳过限流与验签
        if ctx.path_class == PathClass::Static {
            return Ok(false);
        }

        // 3. 速率限制（仅 /api/auth/ 类路径在 limiter 内部命中）
        let ip = ctx.client_ip.as_deref().unwrap_or("unknown");
        if let Some(false) = self.limiter.check(ip, path).await {
            warn!("速率限制触发: ip={}, path={}", ip, path);
            let mut header = ResponseHeader::build(429, None)?;
            header.insert_header("Retry-After", "60")?;
            session
                .write_response_header(Box::new(header), true)
                .await?;
            return Ok(true);
        }

        // 4. 白名单公开路径：跳过验签
        if ctx.path_class == PathClass::Public {
            return Ok(false);
        }

        // 5. 委托验签 + 静默续签；authenticate 返回 true 表示已写回失败响应
        if self.authenticate(session, ctx).await? {
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

        // 微服务路由额外清除伪造的身份 Header（未通过验签时）
        if ctx.path_class == PathClass::Microservice && !ctx.is_authenticated() {
            upstream_request.remove_header("Authorization");
            upstream_request.remove_header("X-User-Id");
            upstream_request.remove_header("X-User-Jti");
        }

        // 按路径分类重写上行 Cookie
        self.rewrite_upstream_cookies(upstream_request, ctx);

        // 注入身份信息 Header（白名单/静态路径 ctx 为空，此处自然为 no-op）
        if let Some(ref auth_header) = ctx.auth_header {
            upstream_request.insert_header("Authorization", auth_header.as_str())?;
        }
        if let Some(ref user_id) = ctx.user_id {
            upstream_request.insert_header("X-User-Id", user_id.as_str())?;
        }
        if let Some(ref user_jti) = ctx.user_jti {
            upstream_request.insert_header("X-User-Jti", user_jti.as_str())?;
        }
        if let Some(ref client_ip) = ctx.client_ip {
            upstream_request.insert_header("X-Client-IP", client_ip.as_str())?;
        }
        if let Some(ref client_ua) = ctx.client_ua {
            upstream_request.insert_header("X-Client-UA", client_ua.as_str())?;
        }

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
        let secure = !host.contains("localhost") && !host.contains("127.0.0.1");
        let secure_str = if secure { "; Secure" } else { "" };

        let at_cookie = format!(
            "portal_jwt_token={}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600{}",
            new_tokens.access, secure_str
        );
        let rt_cookie = format!(
            "portal_refresh_token={}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800{}",
            new_tokens.refresh, secure_str
        );

        upstream_response.append_header("Set-Cookie", at_cookie)?;
        upstream_response.append_header("Set-Cookie", rt_cookie)?;

        info!("下行注入续签 Set-Cookie: sub={:?}", ctx.user_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_should_redirect_to_login() {
        assert!(should_redirect_to_login(
            "GET",
            "text/html,application/xhtml+xml",
            false
        ));
        assert!(should_redirect_to_login("get", "text/html", false));
        assert!(!should_redirect_to_login("POST", "text/html", false));
        assert!(!should_redirect_to_login("GET", "application/json", false));
        assert!(!should_redirect_to_login("GET", "text/html", true));
    }
}
