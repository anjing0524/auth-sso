use std::sync::Arc;

use async_trait::async_trait;
use pingora_core::prelude::*;
use pingora_http::{RequestHeader, ResponseHeader};
use pingora_load_balancing::LoadBalancer;
use pingora_load_balancing::selection::RoundRobin;
use pingora_proxy::{ProxyHttp, Session};
use tracing::debug;

use crate::auth::{JwtVerifier, RefreshedTokens, TokenRefresher};
use crate::cookie;
use crate::http::SessionExt;
use crate::path_matcher::{PathClass, PathMatcher};

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

/// 已通过验签的请求身份 — Authorization 头、用户 ID、jti 三者同生共死，
/// 作为一个整体在请求生命周期中流转（验签成功一起注入，续签成功一起覆盖）。
#[derive(Clone, Debug)]
pub struct Identity {
    /// 预格式化的 Authorization 头部值（例如 "Bearer <token>"）
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
/// - [`LoadBalancer`] — 上游负载均衡（RoundRobin）
/// - [`JwtVerifier`] — JWT 密码学验签 + jti 黑名单
/// - [`TokenRefresher`] — HTTP 静默续签 + Redis 去重
///
/// 限流器为模块级函数 [`crate::rate_limiter::check`]，无需注入。
pub struct Gateway {
    /// 白名单路径匹配器
    path_matcher: PathMatcher,
    /// Portal 上游负载均衡器
    portal_lb: Arc<LoadBalancer<RoundRobin>>,
    /// JWT 验签器
    jwt_verifier: JwtVerifier,
    /// Token 续签器
    token_refresher: TokenRefresher,
}

impl std::fmt::Debug for Gateway {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Gateway")
            .field("path_matcher", &self.path_matcher)
            .field("portal_lb", &"LoadBalancer<RoundRobin>")
            .field("jwt_verifier", &self.jwt_verifier)
            .field("token_refresher", &self.token_refresher)
            .finish()
    }
}

impl Gateway {
    /// 创建网关实例。
    pub fn new(
        path_matcher: PathMatcher,
        portal_lb: Arc<LoadBalancer<RoundRobin>>,
        jwt_verifier: JwtVerifier,
        token_refresher: TokenRefresher,
    ) -> Self {
        Self {
            path_matcher,
            portal_lb,
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
                    tracing::warn!("重写上游 Cookie 失败: {:?}", e);
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

        tracing::info!(
            "下行注入续签 Set-Cookie: sub={:?}",
            ctx.identity.as_ref().map(|i| &i.user_id)
        );
        Ok(())
    }
}
