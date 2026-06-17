use async_trait::async_trait;
use jsonwebtoken::{Algorithm, Validation, decode, decode_header};
use pingora_core::prelude::*;
use pingora_http::{RequestHeader, ResponseHeader};
use pingora_load_balancing::LoadBalancer;
use pingora_load_balancing::selection::RoundRobin;
use pingora_proxy::{ProxyHttp, Session};
use std::collections::HashSet;
use std::sync::Arc;
use tracing::{debug, error, info, warn};

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

        // 通过 OIDC Discovery 动态获取支持的签名算法，替换硬编码的 ES256
        let discovered_algorithms = self.jwks_cache.get_supported_algorithms();
        if !discovered_algorithms.is_empty() {
            validation.algorithms = discovered_algorithms;
            debug!(
                "JWT 验签使用 OIDC Discovery 算法: {:?}",
                validation.algorithms
            );
        } else {
            warn!("⚠️  OIDC 元数据未就绪，回退至默认算法 ES256");
        }

        // 无锁并发进行复杂的密码学 ECDSA 验签计算，消除锁竞争
        match decode::<Claims>(token, &decoding_key, &validation) {
            Ok(token_data) => {
                debug!("JWT 验签通过: sub={}, kid={}", token_data.claims.sub, kid);
                ctx.auth_header = Some(format!("Bearer {}", token));
                ctx.user_id = Some(token_data.claims.sub);
                ctx.user_jti = Some(token_data.claims.jti);
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
} // impl Gateway

/// 零拷贝提取 Cookie 中的 portal_jwt_token 并剥离可能的双引号
///
/// # 参数
/// * `cookie_header` - 原始的 Cookie 请求头字符串
fn extract_token_from_cookie<'a>(cookie_header: &'a str) -> Option<&'a str> {
    cookie_header.split(';').find_map(|cookie_str| {
        let trimmed = cookie_str.trim();
        trimmed.strip_prefix("portal_jwt_token=").map(|mut val| {
            // 容错剥离可能的双引号包裹（RFC 6265）
            if val.starts_with('"') && val.ends_with('"') && val.len() >= 2 {
                val = &val[1..val.len() - 1];
            }
            val
        })
    })
}

/// 网关请求上下文类型，用于在代理的生命周期中传递已解析或已格式化的数据
#[derive(Default, Debug)]
pub struct GatewayCtx {
    /// 预格式化好的 Authorization 头部值（例如 "Bearer <token>"）
    pub auth_header: Option<String>,
    /// 用户 ID (从 JWT Claims.sub 提取，供微服务直接使用)
    pub user_id: Option<String>,
    /// JWT 唯一标识 (从 JWT Claims.jti 提取，方便微服务校验拉黑状态)
    pub user_jti: Option<String>,
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

        // 优雅处理上游节点选择失败的异常，避免在极端的无上游节点可用时触发工作线程 Panic 崩溃。
        // 改为返回 502 错误，保证网关服务整体高可用与容错能力。
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

        // 1. 白名单放行路由与静态资产
        if self.path_matcher.is_public(path) {
            return Ok(false);
        }

        // 2. 提取 JWT 凭证 (零拷贝解包)
        let token = session
            .get_header("Cookie")
            .and_then(|v| v.to_str().ok())
            .and_then(|h| extract_token_from_cookie(h));

        let token = match token {
            Some(t) => t,
            // 未携带凭证，执行鉴权失败阻断
            None => return self.handle_auth_failure(session).await,
        };

        // 3. 执行离线密码学 ES256 签名校验与发行方比对
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
                // 核心安全纵深防护：未登录状态下访问微服务，网关侧强行清除可能被伪造的身份 Header
                upstream_request.remove_header("Authorization");
                upstream_request.remove_header("X-User-Id");
                upstream_request.remove_header("X-User-Jti");
            }
        }

        if let Some(ref auth_header) = ctx.auth_header {
            // 直接以引用方式写入，消除 format!("Bearer {}", token) 的二次内存分配开销
            upstream_request.insert_header("Authorization", auth_header.as_str())?;
        }

        // 注入解析出来的安全上下文 Header，后端微服务即可 O(1) 获取用户 ID，免去重复解析 JWT
        if let Some(ref user_id) = ctx.user_id {
            upstream_request.insert_header("X-User-Id", user_id.as_str())?;
        }
        if let Some(ref user_jti) = ctx.user_jti {
            upstream_request.insert_header("X-User-Jti", user_jti.as_str())?;
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

    #[tokio::test]
    async fn test_verify_jwt_successful() {
        use crate::claims::Claims;
        use crate::jwks::OidcMetadata;
        use jsonwebtoken::{DecodingKey, EncodingKey, Header, encode};

        // 1. 初始化 JwksCache 与 Gateway
        let jwks_cache = JwksCache::new();
        let issuer = "https://sso.example.com".to_string();

        // 模拟 OIDC metadata，配置支持对称加密算法 HS256 进行测试
        jwks_cache.set_metadata_for_test(OidcMetadata {
            issuer: Some(issuer.clone()),
            jwks_uri: Some("https://sso.example.com/api/auth/jwks".into()),
            id_token_signing_alg_values_supported: vec!["HS256".into()],
        });

        // 模拟写入公钥缓存（测试时以 HS256 对称密钥替代）
        let secret = b"super-secret-key-that-is-long-enough-for-hs256";
        let kid = "key-test-1".to_string();
        jwks_cache.insert_key_for_test(kid.clone(), DecodingKey::from_secret(secret));

        let portal_lb = Arc::new(LoadBalancer::try_from_iter(["127.0.0.1:4100"]).unwrap());
        let gateway = Gateway {
            portal_lb,
            jwks_cache: Arc::clone(&jwks_cache),
            issuer: issuer.clone(),
            path_matcher: PathMatcher::new(None),
        };

        // 2. 生成合法的 HS256 Token
        let now = std::time::SystemTime::now()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let claims = Claims {
            sub: "user-123".to_string(),
            iss: issuer.clone(),
            exp: (now + 3600) as usize,
            jti: "jti-123".to_string(),
        };
        let mut header = Header::new(Algorithm::HS256);
        header.kid = Some(kid);
        let token = encode(&header, &claims, &EncodingKey::from_secret(secret)).unwrap();

        // 3. 执行验签
        let mut ctx = GatewayCtx::default();
        let result = gateway.verify_jwt(&token, &mut ctx).await;

        // 4. 断言结果与安全上下文注入
        assert!(result);
        assert_eq!(ctx.user_id, Some("user-123".to_string()));
        assert_eq!(ctx.user_jti, Some("jti-123".to_string()));
        assert_eq!(ctx.auth_header, Some(format!("Bearer {}", token)));
    }

    #[tokio::test]
    async fn test_verify_jwt_expired() {
        use crate::claims::Claims;
        use crate::jwks::OidcMetadata;
        use jsonwebtoken::{DecodingKey, EncodingKey, Header, encode};

        let jwks_cache = JwksCache::new();
        let issuer = "https://sso.example.com".to_string();
        jwks_cache.set_metadata_for_test(OidcMetadata {
            issuer: Some(issuer.clone()),
            jwks_uri: Some("https://sso.example.com/api/auth/jwks".into()),
            id_token_signing_alg_values_supported: vec!["HS256".into()],
        });

        let secret = b"super-secret-key-that-is-long-enough-for-hs256";
        let kid = "key-test-1".to_string();
        jwks_cache.insert_key_for_test(kid.clone(), DecodingKey::from_secret(secret));

        let portal_lb = Arc::new(LoadBalancer::try_from_iter(["127.0.0.1:4100"]).unwrap());
        let gateway = Gateway {
            portal_lb,
            jwks_cache: Arc::clone(&jwks_cache),
            issuer: issuer.clone(),
            path_matcher: PathMatcher::new(None),
        };

        // 生成过期 Token
        let now = std::time::SystemTime::now()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let claims = Claims {
            sub: "user-123".to_string(),
            iss: issuer.clone(),
            exp: (now - 600) as usize, // 10分钟前已过期
            jti: "jti-123".to_string(),
        };
        let mut header = Header::new(Algorithm::HS256);
        header.kid = Some(kid);
        let token = encode(&header, &claims, &EncodingKey::from_secret(secret)).unwrap();

        let mut ctx = GatewayCtx::default();
        let result = gateway.verify_jwt(&token, &mut ctx).await;

        // 应验证失败
        assert!(!result);
    }

    #[tokio::test]
    async fn test_verify_jwt_invalid_issuer() {
        use crate::claims::Claims;
        use crate::jwks::OidcMetadata;
        use jsonwebtoken::{DecodingKey, EncodingKey, Header, encode};

        let jwks_cache = JwksCache::new();
        let issuer = "https://sso.example.com".to_string();
        jwks_cache.set_metadata_for_test(OidcMetadata {
            issuer: Some(issuer.clone()),
            jwks_uri: Some("https://sso.example.com/api/auth/jwks".into()),
            id_token_signing_alg_values_supported: vec!["HS256".into()],
        });

        let secret = b"super-secret-key-that-is-long-enough-for-hs256";
        let kid = "key-test-1".to_string();
        jwks_cache.insert_key_for_test(kid.clone(), DecodingKey::from_secret(secret));

        let portal_lb = Arc::new(LoadBalancer::try_from_iter(["127.0.0.1:4100"]).unwrap());
        let gateway = Gateway {
            portal_lb,
            jwks_cache: Arc::clone(&jwks_cache),
            issuer: issuer.clone(),
            path_matcher: PathMatcher::new(None),
        };

        // 错误发行方 (issuer)
        let now = std::time::SystemTime::now()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let claims = Claims {
            sub: "user-123".to_string(),
            iss: "https://hacker.com".to_string(),
            exp: (now + 3600) as usize,
            jti: "jti-123".to_string(),
        };
        let mut header = Header::new(Algorithm::HS256);
        header.kid = Some(kid);
        let token = encode(&header, &claims, &EncodingKey::from_secret(secret)).unwrap();

        let mut ctx = GatewayCtx::default();
        let result = gateway.verify_jwt(&token, &mut ctx).await;

        // 应验证失败
        assert!(!result);
    }

    #[tokio::test]
    async fn test_verify_jwt_invalid_kid() {
        use crate::claims::Claims;
        use crate::jwks::OidcMetadata;
        use jsonwebtoken::{DecodingKey, EncodingKey, Header, encode};

        let jwks_cache = JwksCache::new();
        let issuer = "https://sso.example.com".to_string();
        jwks_cache.set_metadata_for_test(OidcMetadata {
            issuer: Some(issuer.clone()),
            jwks_uri: Some("https://sso.example.com/api/auth/jwks".into()),
            id_token_signing_alg_values_supported: vec!["HS256".into()],
        });

        let secret = b"super-secret-key-that-is-long-enough-for-hs256";
        let kid = "key-test-1".to_string();
        jwks_cache.insert_key_for_test(kid, DecodingKey::from_secret(secret));

        let portal_lb = Arc::new(LoadBalancer::try_from_iter(["127.0.0.1:4100"]).unwrap());
        let gateway = Gateway {
            portal_lb,
            jwks_cache: Arc::clone(&jwks_cache),
            issuer: issuer.clone(),
            path_matcher: PathMatcher::new(None),
        };

        let now = std::time::SystemTime::now()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let claims = Claims {
            sub: "user-123".to_string(),
            iss: issuer.clone(),
            exp: (now + 3600) as usize,
            jti: "jti-123".to_string(),
        };
        let mut header = Header::new(Algorithm::HS256);
        // 使用一个未在缓存中登记的 kid
        header.kid = Some("unknown-kid".to_string());
        let token = encode(&header, &claims, &EncodingKey::from_secret(secret)).unwrap();

        let mut ctx = GatewayCtx::default();
        let result = gateway.verify_jwt(&token, &mut ctx).await;

        // 应验证失败
        assert!(!result);
    }
}
