use async_trait::async_trait;
use jsonwebtoken::{Algorithm, Validation, decode, decode_header};
use log::{error, info, warn};
use pingora_core::prelude::*;
use pingora_http::{RequestHeader, ResponseHeader};
use pingora_load_balancing::LoadBalancer;
use pingora_load_balancing::selection::RoundRobin;
use pingora_proxy::{ProxyHttp, Session};
use std::sync::Arc;

use crate::claims::Claims;
use crate::jwks::JwksCache;

/// 校验路径是否为静态资源文件或公开访问的接口与路由
fn is_public_asset_or_route(path: &str) -> bool {
    // 1. 放行静态资源目录
    if path.starts_with("/_next/") || path.starts_with("/static/") {
        return true;
    }

    // 2. 放行常见静态资产文件的扩展名
    let lower_path = path.to_lowercase();
    if lower_path.ends_with(".js")
        || lower_path.ends_with(".css")
        || lower_path.ends_with(".ico")
        || lower_path.ends_with(".png")
        || lower_path.ends_with(".jpg")
        || lower_path.ends_with(".jpeg")
        || lower_path.ends_with(".gif")
        || lower_path.ends_with(".svg")
        || lower_path.ends_with(".woff")
        || lower_path.ends_with(".woff2")
        || lower_path.ends_with(".ttf")
        || lower_path.ends_with(".json")
        || lower_path.ends_with(".txt")
    {
        return true;
    }

    // 3. 放行公开页面与身份校验路由
    if path == "/login"
        || path == "/register"
        || path == "/error"
        || path == "/"
        || path.starts_with("/api/auth/")
        || path.starts_with("/oauth2/")
        || path.starts_with("/.well-known/")
    {
        return true;
    }

    false
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
}

impl Gateway {
    async fn verify_jwt(&self, token: &str, ctx: &mut <Self as ProxyHttp>::CTX) -> bool {
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

        let keys_guard = self.jwks_cache.keys.read().await;
        let decoding_key = match keys_guard.get(&kid) {
            Some(k) => k,
            None => {
                error!("JWKS 缓存中未找到对应的 kid: {}", kid);
                return false;
            }
        };

        let mut validation = Validation::new(Algorithm::ES256);
        validation.set_issuer(&[&self.issuer]);

        match decode::<Claims>(token, decoding_key, &validation) {
            Ok(token_data) => {
                info!("JWT 验签通过: sub={}, kid={}", token_data.claims.sub, kid);
                *ctx = Some(token.to_string());
                true
            }
            Err(e) => {
                warn!("JWT 载荷校验失败: {:?}", e);
                false
            }
        }
    }

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

#[async_trait]
impl ProxyHttp for Gateway {
    type CTX = Option<String>;
    fn new_ctx(&self) -> Self::CTX {
        None
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

        info!("接收代理请求，Host: {}", host);

        let peer = self.portal_lb.select(b"", 256).unwrap();
        info!("路由至 Portal 上游: {:?}", peer);
        Ok(Box::new(HttpPeer::new(peer, false, "portal".to_string())))
    }

    async fn request_filter(&self, session: &mut Session, ctx: &mut Self::CTX) -> Result<bool> {
        let path = session.req_header().uri.path();
        if is_public_asset_or_route(path) {
            return Ok(false);
        }

        let jwt_token = session
            .get_header("Cookie")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| {
                s.split(';').find_map(|part| {
                    let mut kv = part.trim().splitn(2, '=');
                    match (kv.next(), kv.next()) {
                        (Some(k), Some(v)) if k.trim() == "portal_jwt_token" => {
                            Some(v.trim().to_owned())
                        }
                        _ => None,
                    }
                })
            });

        let token = match jwt_token {
            Some(t) => t,
            None => return self.handle_auth_failure(session).await,
        };

        if !self.verify_jwt(&token, ctx).await {
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
        }

        // 将已验签的 JWT 以标准 Bearer Token 形式注入，供微服务独立验签使用
        if let Some(ref token) = *ctx {
            upstream_request.insert_header("Authorization", format!("Bearer {}", token))?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_public_asset_or_route() {
        // 静态目录资产放行
        assert!(is_public_asset_or_route("/_next/static/chunks/main.js"));
        assert!(is_public_asset_or_route("/static/images/logo.png"));

        // 静态资源文件扩展名放行
        assert!(is_public_asset_or_route("/favicon.ico"));
        assert!(is_public_asset_or_route("/logo.PNG")); // 测试大小写不敏感
        assert!(is_public_asset_or_route("/robots.txt"));
        assert!(is_public_asset_or_route("/site.webmanifest.json"));

        // 公开页面和认证接口放行
        assert!(is_public_asset_or_route("/login"));
        assert!(is_public_asset_or_route("/register"));
        assert!(is_public_asset_or_route("/error"));
        assert!(is_public_asset_or_route("/"));
        assert!(is_public_asset_or_route("/api/auth/session"));
        assert!(is_public_asset_or_route("/oauth2/authorize"));
        assert!(is_public_asset_or_route("/.well-known/jwks.json"));

        // 受保护的管理页面和路由应该拦截 (返回 false)
        assert!(!is_public_asset_or_route("/dashboard"));
        assert!(!is_public_asset_or_route("/dashboard/users"));
        assert!(!is_public_asset_or_route("/profile"));
        assert!(!is_public_asset_or_route("/api/v1/users"));
    }

    #[test]
    fn test_should_redirect_to_login() {
        // 浏览器普通 GET 页面导航请求 -> 应该 302 重定向 (返回 true)
        assert!(should_redirect_to_login(
            "GET",
            "text/html,application/xhtml+xml",
            false
        ));
        assert!(should_redirect_to_login("get", "text/html", false));

        // POST 请求 (例如 Server Action) -> 应该 401 拦截 (返回 false)
        assert!(!should_redirect_to_login("POST", "text/html", false));

        // API JSON 请求 -> 应该 401 拦截 (返回 false)
        assert!(!should_redirect_to_login("GET", "application/json", false));

        // Next.js RSC 请求 (虽然是 GET，但带有 RSC 标识) -> 应该 401 拦截 (返回 false)
        assert!(!should_redirect_to_login("GET", "text/html", true));
    }

    #[test]
    fn test_is_microservice_route() {
        // 属于微服务路由 -> 应该剥离 Cookie (返回 true)
        assert!(is_microservice_route("/api/v1/users"));
        assert!(is_microservice_route("/api/v1/products/123"));

        // 属于认证接口或 Portal BFF 路由 -> 不应剥离 Cookie (返回 false)
        assert!(!is_microservice_route("/api/auth/session"));
        assert!(!is_microservice_route("/api/v1/auth/login")); // 排除微服务里的 auth 子路径
        assert!(!is_microservice_route("/dashboard"));
        assert!(!is_microservice_route("/_next/data/xxx.json"));
    }
}
