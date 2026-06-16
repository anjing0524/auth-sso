use async_trait::async_trait;
use jsonwebtoken::{Algorithm, Validation, decode, decode_header};
use tracing::{debug, error, info, warn};
use pingora_core::prelude::*;
use pingora_http::{RequestHeader, ResponseHeader};
use pingora_load_balancing::LoadBalancer;
use pingora_load_balancing::selection::RoundRobin;
use pingora_proxy::{ProxyHttp, Session};
use std::collections::HashSet;
use std::sync::Arc;

use crate::claims::Claims;
use crate::jwks::JwksCache;

/// 预分类和高性能过滤的公开路径匹配器
#[derive(Debug, Clone)]
pub struct PathMatcher {
    public_exact_paths: HashSet<String>,
    public_prefix_paths: Vec<String>,
}

impl PathMatcher {
    /// 初始化并对白名单进行分类与高性能前缀排序
    pub fn new(public_paths: Option<Vec<String>>) -> Self {
        let mut exact_paths = HashSet::new();
        let mut prefix_paths = Vec::new();
        for path in public_paths.unwrap_or_default() {
            if path.ends_with('/') && path != "/" {
                prefix_paths.push(path);
            } else {
                exact_paths.insert(path);
            }
        }
        // 性能优化：降序排列前缀以尽早触及深度具体路径
        prefix_paths.sort_by_key(|p| std::cmp::Reverse(p.len()));

        Self {
            public_exact_paths: exact_paths,
            public_prefix_paths: prefix_paths,
        }
    }

    /// 校验当前请求路径是否放行
    pub fn is_public(&self, path: &str) -> bool {
        // 1. 放行静态资源目录
        if path.starts_with("/_next/") || path.starts_with("/static/") {
            return true;
        }

        // 2. 常见静态资产文件的扩展名放行
        const STATIC_EXTENSIONS: &[&str] = &[
            "js", "css", "ico", "png", "jpg", "jpeg", "gif", "svg", "woff", "woff2", "ttf", "json",
            "txt",
        ];
        if let Some(idx) = path.rfind('.') {
            let ext = &path[idx + 1..];
            if !ext.contains('/')
                && STATIC_EXTENSIONS
                    .iter()
                    .any(|&static_ext| ext.eq_ignore_ascii_case(static_ext))
            {
                return true;
            }
        }

        // 3. O(1) 快速精确匹配
        if self.public_exact_paths.contains(path) {
            return true;
        }

        // 4. 动态前缀放行路径匹配
        for prefix in &self.public_prefix_paths {
            if path.starts_with(prefix) {
                return true;
            }
        }

        false
    }
}

/// 根据请求的上下文特性，决策是执行 302 重定向至登录页（对于浏览器普通 GET 页面导航）
/// 还是直接返回 401 拦截（对于 API、Next.js RSC、Server Action 等）
fn should_redirect_to_login(method: &str, accept: &str, has_rsc: bool) -> bool {
    let is_get = method.eq_ignore_ascii_case("GET");
    let is_html = accept.contains("text/html");
    is_get && is_html && !has_rsc
}

/// 判断请求路径是否发往内网后端微服务
/// 规则：以 /api/v1/ 开头且排除 /api/v1/auth/ 登录校验类接口
fn is_microservice_route(path: &str) -> bool {
    path.starts_with("/api/v1/") && !path.starts_with("/api/v1/auth/")
}

/// Auth-SSO 去中心化安全网关 - 基于 Pingora (0.8.0 + OpenSSL)
pub struct Gateway {
    /// Portal 上游负载均衡器（Portal 已合并 IdP，统一代理入口）
    pub portal_lb: Arc<LoadBalancer<RoundRobin>>,
    /// JWKS 公钥缓存（支持根据 kid 精准匹配 DecodingKey）
    pub jwks_cache: Arc<JwksCache>,
    /// Portal OIDC Provider 的 JWT issuer（校验 iss claim）
    pub issuer: String,
    /// 公开路径匹配器
    pub path_matcher: PathMatcher,
}

impl Gateway {
    /// 对 JWT Token 进行 ES256 离线验签，支持基于 kid 匹配对应公钥
    async fn verify_jwt(&self, token: &str, ctx: &mut GatewayCtx) -> bool {
        let header = match decode_header(token) {
            Ok(h) => h,
            Err(e) => {
                warn!("JWT 头部解析失败: {:?}", e);
                return false;
            }
        };

        let kid = match header.kid {
            Some(k) => k,
            None => {
                warn!("JWT 头部未包含 kid");
                return false;
            }
        };

        let decoding_key = match self.jwks_cache.get_key(&kid) {
            Some(k) => k,
            None => {
                error!("JWKS 缓存中未找到对应的 kid: {}", kid);
                return false;
            }
        };

        let mut validation = Validation::new(Algorithm::ES256);
        validation.set_issuer(&[&self.issuer]);

        // 无锁并发进行复杂的密码学 ECDSA 验签计算，消除锁竞争
        match decode::<Claims>(token, &decoding_key, &validation) {
            Ok(token_data) => {
                debug!("JWT 验签通过: sub={}, kid={}", token_data.claims.sub, kid);
                ctx.auth_header = Some(format!("Bearer {}", token));
                true
            }
            Err(e) => {
                warn!("JWT 载荷校验失败: {:?}", e);
                false
            }
        }
    }

    /// 统一鉴权失败拦截处理器
    async fn handle_auth_failure(&self, session: &mut Session) -> Result<bool> {
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
}

/// 网关请求上下文类型，用于在代理的生命周期中传递已解析或已格式化的数据
#[derive(Default, Debug)]
pub struct GatewayCtx {
    /// 预格式化好的 Authorization 头部值（例如 "Bearer <token>"）
    pub auth_header: Option<String>,
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
        let host = session
            .get_header("Host")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("");

        debug!("接收代理请求，Host: {}", host);

        let peer = self.portal_lb.select(b"", 256).unwrap();
        debug!("路由至 Portal 上游: {:?}", peer);
        Ok(Box::new(HttpPeer::new(peer, false, "portal".to_string())))
    }

    async fn request_filter(&self, session: &mut Session, ctx: &mut Self::CTX) -> Result<bool> {
        let path = session.req_header().uri.path();
        if self.path_matcher.is_public(path) {
            return Ok(false);
        }

        // 提取 Cookie 头部为局部引用以延长其引用的生命周期，实现 100% 零拷贝的 Token 提取
        let cookie_header = session.get_header("Cookie").and_then(|v| v.to_str().ok());

        let jwt_token = cookie_header.and_then(|header| {
            header.split(';').find_map(|cookie_str| {
                let trimmed = cookie_str.trim();
                if let Some(stripped) = trimmed.strip_prefix("portal_jwt_token=") {
                    let mut val = stripped;
                    // 容错剥离可能的双引号包裹（RFC 6265）
                    if val.starts_with('"') && val.ends_with('"') && val.len() >= 2 {
                        val = &val[1..val.len() - 1];
                    }
                    Some(val)
                } else {
                    None
                }
            })
        });

        let token = match jwt_token {
            Some(t) => t,
            None => return self.handle_auth_failure(session).await,
        };

        if !self.verify_jwt(token, ctx).await {
            return self.handle_auth_failure(session).await;
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

        let path = session.req_header().uri.path();
        if is_microservice_route(path) {
            upstream_request.remove_header("Cookie");
            if ctx.auth_header.is_none() {
                // 核心安全纵深防护：未登录状态下访问微服务，网关侧强行清除 Authorization 头，防止客户端假冒 Bearer 伪造绕过
                upstream_request.remove_header("Authorization");
            }
        }

        if let Some(ref auth_header) = ctx.auth_header {
            // 直接以引用方式写入，消除 format!("Bearer {}", token) 的二次内存分配开销
            upstream_request.insert_header("Authorization", auth_header.as_str())?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_public_asset_or_route() {
        let public_paths = vec![
            "/login".to_string(),
            "/register".to_string(),
            "/error".to_string(),
            "/".to_string(),
            "/api/auth/".to_string(),
            "/oauth2/".to_string(),
            "/.well-known/".to_string(),
        ];
        let matcher = PathMatcher::new(Some(public_paths));

        // 静态目录资产放行
        assert!(matcher.is_public("/_next/static/chunks/main.js"));
        assert!(matcher.is_public("/static/images/logo.png"));

        // 静态资源文件扩展名放行
        assert!(matcher.is_public("/favicon.ico"));
        assert!(matcher.is_public("/logo.PNG")); // 测试大小写不敏感
        assert!(matcher.is_public("/robots.txt"));
        assert!(matcher.is_public("/site.webmanifest.json"));

        // 公开页面和认证接口放行 (前缀或精确相等)
        assert!(matcher.is_public("/login"));
        assert!(matcher.is_public("/register"));
        assert!(matcher.is_public("/error"));
        assert!(matcher.is_public("/"));
        assert!(matcher.is_public("/api/auth/session"));
        assert!(matcher.is_public("/oauth2/authorize"));
        assert!(matcher.is_public("/.well-known/jwks.json"));

        // 受保护的管理页面和路由应该拦截 (返回 false)
        assert!(!matcher.is_public("/dashboard"));
        assert!(!matcher.is_public("/dashboard/users"));
        assert!(!matcher.is_public("/profile"));
        assert!(!matcher.is_public("/api/v1/users"));
    }

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

    #[test]
    fn test_is_microservice_route() {
        assert!(is_microservice_route("/api/v1/users"));
        assert!(is_microservice_route("/api/v1/products/123"));
        assert!(!is_microservice_route("/api/auth/session"));
        assert!(!is_microservice_route("/api/v1/auth/login"));
        assert!(!is_microservice_route("/dashboard"));
        assert!(!is_microservice_route("/_next/data/xxx.json"));
    }
}
