use std::sync::Arc;

use async_trait::async_trait;
use pingora_core::prelude::*;
use pingora_http::{RequestHeader, ResponseHeader};
use pingora_load_balancing::LoadBalancer;
use pingora_load_balancing::selection::RoundRobin;
use pingora_proxy::{ProxyHttp, Session};
use tracing::{debug, info, warn};

use crate::auth::{AuthService, RefreshedTokens, VerifyResult};
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

/// 当 `value` 为 `Some` 时向请求头注入；`None` 视为 no-op
fn insert_opt_header(
    req: &mut RequestHeader,
    name: &'static str,
    value: &Option<String>,
) -> Result<()> {
    if let Some(v) = value {
        req.insert_header(name, v.as_str())?;
    }
    Ok(())
}

/// 已通过验签的请求身份 — Authorization 头、用户 ID、jti 三者同生共死，
/// 作为一个整体在请求生命周期中流转（验签成功一起注入，续签成功一起覆盖）。
#[derive(Clone, Debug)]
pub struct Identity {
    /// 预格式化的 Authorization 头部值（例如 "Bearer <token>"）
    auth_header: String,
    /// 用户 ID（从 JWT Claims.sub 提取）
    user_id: String,
    /// JWT 唯一标识（从 JWT Claims.jti 提取）
    user_jti: String,
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
    /// 客户端真实 IP（从 X-Forwarded-For 提取）
    pub client_ip: Option<String>,
    /// 客户端 User-Agent
    pub client_ua: Option<String>,
}

impl GatewayCtx {
    /// 是否已通过验签（即上行应注入身份 Header）
    fn is_authenticated(&self) -> bool {
        self.identity.is_some()
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

        let token = match cookie_header
            .and_then(|h| cookie::extract_from_header(h, cookie::ACCESS_COOKIE))
        {
            Some(t) => t,
            None => return respond_auth_failure(session).await,
        };

        let verified_result = match self.auth_service.verify_jwt(token).await {
            Some(v) => v,
            None => return respond_auth_failure(session).await,
        };

        // 先用旧 Token 的身份填充 ctx；续签成功后在下方被新身份整体覆盖
        let verified = verified_result.verified();
        ctx.identity = Some(Identity {
            auth_header: format!("Bearer {}", token),
            user_id: verified.user_id.clone(),
            user_jti: verified.jti.clone(),
        });

        // 完全有效 → 直接放行
        if matches!(verified_result, VerifyResult::Valid(_)) {
            return Ok(false);
        }

        // NeedsRefresh / Expired：尽力静默续签（刷新身份并下行新 Cookie）
        let mut refreshed = false;
        if let Some(rt) =
            cookie_header.and_then(|h| cookie::extract_from_header(h, cookie::REFRESH_COOKIE))
            && let Some(new_tokens) = self
                .auth_service
                .try_refresh_token(rt, &verified.user_id)
                .await
            && let Some(new_claims) = crate::auth::decode_jwt_payload(&new_tokens.access)
        {
            ctx.identity = Some(Identity {
                auth_header: format!("Bearer {}", new_tokens.access),
                user_id: new_claims.sub,
                user_jti: new_claims.jti,
            });
            ctx.refreshed_tokens = Some(new_tokens);
            refreshed = true;
        }

        // 仅「已过期且续签失败」才阻断；NeedsRefresh 续签失败时旧 AT 仍有效，放行
        if matches!(verified_result, VerifyResult::Expired(_)) && !refreshed {
            return respond_auth_failure(session).await;
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
        let host = header_str(session, "Host").unwrap_or("");
        debug!("接收代理请求，Host: {}", host);

        let peer = self.portal_lb.select(b"", 256).ok_or_else(|| {
            Error::explain(
                ErrorType::HTTPStatus(502),
                "gateway: 无可用 Portal 上游节点，请检查配置文件中的 upstream 设置",
            )
        })?;
        debug!("路由至 Portal 上游: {:?}", peer);
        // tls=false（上行明文 HTTP），SNI 不会被使用，传空字符串避免每请求一次堆分配
        Ok(Box::new(HttpPeer::new(peer, false, String::new())))
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
        if let Some(false) = self.limiter.check(ip, path) {
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

        // 全路径净化：未通过验签时，强力清除上行请求中可能由客户端伪造的身份 Header，实现全域零信任安全防伪造
        if !ctx.is_authenticated() {
            upstream_request.remove_header("Authorization");
            upstream_request.remove_header("X-User-Id");
            upstream_request.remove_header("X-User-Jti");
        }

        // 按路径分类重写上行 Cookie
        self.rewrite_upstream_cookies(upstream_request, ctx);

        // 注入身份信息 Header：identity 三项同生共死，一起注入；
        // client_ip / client_ua 独立可选。白名单/静态路径 ctx.identity 为 None，自然 no-op。
        if let Some(id) = &ctx.identity {
            upstream_request.insert_header("Authorization", id.auth_header.as_str())?;
            upstream_request.insert_header("X-User-Id", id.user_id.as_str())?;
            upstream_request.insert_header("X-User-Jti", id.user_jti.as_str())?;
        }
        insert_opt_header(upstream_request, "X-Client-IP", &ctx.client_ip)?;
        insert_opt_header(upstream_request, "X-Client-UA", &ctx.client_ua)?;

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
            "{}={}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600{}",
            cookie::ACCESS_COOKIE,
            new_tokens.access,
            secure_str
        );
        let rt_cookie = format!(
            "{}={}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800{}",
            cookie::REFRESH_COOKIE,
            new_tokens.refresh,
            secure_str
        );

        upstream_response.append_header("Set-Cookie", at_cookie)?;
        upstream_response.append_header("Set-Cookie", rt_cookie)?;

        info!(
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
