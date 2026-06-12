use async_trait::async_trait;
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use log::{error, info, warn};
use pingora_core::prelude::*;
use pingora_core::listeners::tls::TlsSettings;
use pingora_http::{RequestHeader, ResponseHeader};
use pingora_load_balancing::selection::RoundRobin;
use pingora_load_balancing::LoadBalancer;
use pingora_proxy::{http_proxy_service, ProxyHttp, Session};
use serde::{Deserialize, Serialize};
use std::env;
use std::sync::Arc;
use tokio::sync::RwLock;

/**
 * Auth-SSO 去中心化安全网关 - 基于 Pingora (0.8.0 + OpenSSL)
 *
 * 核心功能：
 * 1. SNI 域名分发路由（idp.* / portal.* → Portal，Portal 自身即是 OIDC Provider）
 * 2. portal_jwt_token Cookie 提取 + ES256 JWKS 离线验签（100% 无网络 I/O）
 * 3. Cookie 剥离 + Authorization: Bearer Token 注入（下发给内网微服务）
 * 4. JWKS 公钥后台定时刷新（每 5 分钟，支持 Portal 密钥轮换）
 * 5. 全局 HTTPS 安全加固与强制 HTTP→HTTPS 301 重定向
 */

// ─────────────────────────────────────────────────────────────
// JWT 声明结构（仅用于验签时的最小字段解析）
// ─────────────────────────────────────────────────────────────

/**
 * JWT 载荷核心声明（验签时只需这几个字段，权限细节由微服务自行解析）
 */
#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,
    iss: String,
    exp: usize,
    jti: String,
}

// ─────────────────────────────────────────────────────────────
// JWKS 公钥缓存
// ─────────────────────────────────────────────────────────────

/**
 * JWKS 公钥缓存结构体
 * 使用 RwLock 实现：多个请求并发读，刷新时独占写
 */
pub struct JwksCache {
    pub key: RwLock<Option<DecodingKey>>,
}

impl JwksCache {
    /**
     * 创建空的 JWKS 缓存实例
     */
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            key: RwLock::new(None),
        })
    }

    /**
     * 从 Portal JWKS 端点拉取公钥并更新缓存
     * 生产环境应按 JWT Header 的 kid 字段匹配对应公钥
     *
     * @param jwks_url Portal 的 JWKS 端点 URL（如 https://portal.xxx.com/.well-known/jwks）
     */
    pub async fn refresh(&self, jwks_url: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let resp = reqwest::get(jwks_url).await?;
        let jwks: serde_json::Value = resp.json().await?;

        if let Some(keys) = jwks["keys"].as_array() {
            if let Some(key_obj) = keys.first() {
                let key = DecodingKey::from_jwk(&serde_json::from_value(key_obj.clone())?)?;
                *self.key.write().await = Some(key);
                info!("JWKS 公钥缓存刷新成功，来源: {}", jwks_url);
                return Ok(());
            }
        }

        Err("JWKS 响应中未找到有效公钥".into())
    }
}

// ─────────────────────────────────────────────────────────────
// 网关核心结构
// ─────────────────────────────────────────────────────────────

struct Gateway {
    idp_lb: Arc<LoadBalancer<RoundRobin>>,
    portal_lb: Arc<LoadBalancer<RoundRobin>>,
    /// JWKS 公钥缓存（由 main 中的后台任务每 5 分钟刷新）
    jwks_cache: Arc<JwksCache>,
    /// Portal OIDC Provider 的 JWT issuer（校验 iss claim）
    idp_issuer: String,
}

#[async_trait]
impl ProxyHttp for Gateway {
    /// CTX 在 request_filter 和 upstream_request_filter 之间传递已验证的 JWT 字符串
    type CTX = Option<String>;
    fn new_ctx(&self) -> Self::CTX {
        None
    }

    /**
     * 根据 Host 头部智能路由选择后端上游服务器
     * idp.* → IdP 认证中心
     * portal.* → Portal 门户
     * 其余 → 未来可扩展为微服务集群路由
     */
    async fn upstream_peer(&self, session: &mut Session, _ctx: &mut Self::CTX) -> Result<Box<HttpPeer>> {
        let host = session
            .get_header("Host")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("");

        info!("接收代理请求，Host: {}", host);

        if host.starts_with("idp.") {
            let peer = self.idp_lb.select(b"", 256).unwrap();
            info!("路由至 IdP 上游: {:?}", peer);
            return Ok(Box::new(HttpPeer::new(peer, false, "idp".to_string())));
        } else if host.starts_with("portal.") {
            let peer = self.portal_lb.select(b"", 256).unwrap();
            info!("路由至 Portal 上游: {:?}", peer);
            return Ok(Box::new(HttpPeer::new(peer, false, "portal".to_string())));
        }

        warn!("未匹配的 Host: {}", host);
        Err(Error::explain(
            ErrorType::HTTPStatus(404),
            "SSO Gateway: Host not found or not matched",
        ))
    }

    /**
     * 网关前置拦截器：ES256 JWKS 离线验签，100% 无网络 I/O
     *
     * 流程：
     * 1. 放行 OIDC/IdP/静态资源路由
     * 2. 从 portal_jwt_token Cookie 提取 JWT
     * 3. 从 JWKS 内存缓存取公钥，纯 CPU 本地验签
     * 4. 验签通过则在 CTX 中暂存 JWT，等待 upstream_request_filter 注入 Bearer
     */
    async fn request_filter(&self, session: &mut Session, ctx: &mut Self::CTX) -> Result<bool> {
        let path = session.req_header().uri.path();
        let host = session.get_header("Host").and_then(|h| h.to_str().ok()).unwrap_or("");

        // 1. 放行：Portal OIDC 认证路由 + 静态资源 + JWKS 端点
        if host.starts_with("idp.")
            || path.starts_with("/api/auth/")
            || path.starts_with("/oauth2/")
            || path.starts_with("/.well-known/")
            || path.starts_with("/_next/")
            || path.starts_with("/static/")
        {
            return Ok(false);
        }

        // 2. 从 Cookie 提取 portal_jwt_token
        // 关键：使用 splitn(2, '=') 防止 JWT base64 padding '=' 截断 Token 值
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
            None => {
                warn!("请求未携带 portal_jwt_token Cookie，拒绝访问: {}", path);
                let mut header = ResponseHeader::build(401, None)?;
                header.insert_header("WWW-Authenticate", "Bearer")?;
                session.write_response_header(Box::new(header), true).await?;
                return Ok(true); // 拦截阻断
            }
        };

        // 3. 从 JWKS 缓存取 ES256 公钥（读锁，不阻塞其他并发请求）
        let key_guard = self.jwks_cache.key.read().await;
        let decoding_key = match key_guard.as_ref() {
            Some(k) => k,
            None => {
                error!("JWKS 公钥缓存未就绪，拒绝请求: {}", path);
                let header = ResponseHeader::build(503, None)?;
                session.write_response_header(Box::new(header), true).await?;
                return Ok(true);
            }
        };

        // 4. ES256 离线验签（校验签名 + exp + iss，防止过期和跨服务 Token 重放攻击）
        let mut validation = Validation::new(Algorithm::ES256);
        validation.set_issuer(&[&self.idp_issuer]);
        // 注意：不强制校验 aud，由微服务各自按需校验

        match decode::<Claims>(&token, decoding_key, &validation) {
            Ok(token_data) => {
                info!(
                    "JWT 验签通过: sub={}, jti={}, path={}",
                    token_data.claims.sub, token_data.claims.jti, path
                );
                *ctx = Some(token); // 暂存 JWT，供 upstream_request_filter 注入 Bearer
                Ok(false) // 放行
            }
            Err(e) => {
                warn!("JWT 验签失败: {:?}, path={}", e, path);
                let header = ResponseHeader::build(401, None)?;
                session.write_response_header(Box::new(header), true).await?;
                Ok(true) // 拦截阻断
            }
        }
    }

    /**
     * 代理转发拦截器：剥离 Cookie + 注入标准 Bearer Token Header
     *
     * 执行顺序在 request_filter 之后（请求已通过验签）：
     * 1. 注入 X-Forwarded-Proto 等代理标准头
     * 2. 物理剥离 Cookie（防止内网 CSRF 渗透）
     * 3. 注入 Authorization: Bearer <JWT>（微服务凭此独立验签）
     */
    async fn upstream_request_filter(
        &self,
        session: &mut Session,
        upstream_request: &mut RequestHeader,
        ctx: &mut Self::CTX,
    ) -> Result<()> {
        // 注入代理协议标准头
        upstream_request.insert_header("X-Forwarded-Proto", "https")?;

        // 透传原始 Host（解决 Next.js/Better Auth 内部绝对 URL 生成问题）
        if let Some(host) = session.get_header("Host") {
            upstream_request.insert_header("Host", host)?;
            upstream_request.insert_header("X-Forwarded-Host", host)?;
        }

        // 物理剥离 Cookie，防止内网微服务因 Cookie 泄露遭受 CSRF 攻击
        upstream_request.remove_header("Cookie");

        // 将已验签的 JWT 以标准 Bearer Token 形式注入，供微服务独立验签使用
        if let Some(ref token) = *ctx {
            upstream_request.insert_header("Authorization", format!("Bearer {}", token))?;
        }

        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────
// 主函数：初始化网关 + JWKS 后台刷新任务
// ─────────────────────────────────────────────────────────────

fn main() {
    env_logger::init();
    info!("🚀 SSO 去中心化安全网关启动中 (Pingora 0.8.0 + ES256 JWKS 验签)...");

    // 读取环境变量配置
    let idp_upstream = env::var("IDP_UPSTREAM").unwrap_or_else(|_| "127.0.0.1:4101".to_string());
    let portal_upstream = env::var("PORTAL_UPSTREAM").unwrap_or_else(|_| "127.0.0.1:4100".to_string());
    let jwks_url = env::var("IDP_JWKS_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:4101/api/auth/.well-known/jwks".to_string());
    let idp_issuer = env::var("IDP_ISSUER")
        .unwrap_or_else(|_| "http://localhost:4101".to_string());
    let ssl_port = env::var("GATEWAY_SSL_PORT").unwrap_or_else(|_| "18443".to_string());
    let redirect_port = env::var("GATEWAY_PORT").unwrap_or_else(|_| "18080".to_string());
    let cert_path = env::var("SSL_CERT_PATH").unwrap_or_else(|_| "/tmp/gateway/ssl/fullchain.pem".to_string());
    let key_path = env::var("SSL_KEY_PATH").unwrap_or_else(|_| "/tmp/gateway/ssl/privkey.pem".to_string());

    info!("配置加载完成:");
    info!("  IdP 上游: {}", idp_upstream);
    info!("  Portal 上游: {}", portal_upstream);
    info!("  JWKS URL: {}", jwks_url);
    info!("  IdP Issuer: {}", idp_issuer);

    // 初始化 JWKS 公钥缓存
    let jwks_cache = JwksCache::new();

    // 启动 tokio 运行时以支持 JWKS 后台刷新任务
    let rt = tokio::runtime::Runtime::new().expect("tokio Runtime 初始化失败");

    // 启动 JWKS 后台定时刷新任务（每 5 分钟拉取一次，支持 Portal 密钥轮换）
    let cache_for_task = Arc::clone(&jwks_cache);
    let jwks_url_clone = jwks_url.clone();
    rt.spawn(async move {
        loop {
            match cache_for_task.refresh(&jwks_url_clone).await {
                Ok(_) => info!("✅ JWKS 公钥缓存刷新成功"),
                Err(e) => error!("❌ JWKS 公钥缓存刷新失败: {:?}", e),
            }
            tokio::time::sleep(std::time::Duration::from_secs(300)).await;
        }
    });

    // 阻塞等待首次 JWKS 刷新完成（最多等待 10 秒），确保网关启动时公钥就绪
    rt.block_on(async {
        for attempt in 1..=5 {
            match jwks_cache.refresh(&jwks_url).await {
                Ok(_) => {
                    info!("✅ 首次 JWKS 公钥加载成功（第 {} 次尝试）", attempt);
                    break;
                }
                Err(e) => {
                    warn!("⚠️  首次 JWKS 加载失败（第 {} 次）: {:?}，2 秒后重试", attempt, e);
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
            }
        }
    });

    // 初始化 Pingora 服务器
    let mut my_server = Server::new(None).unwrap();
    my_server.bootstrap();

    // 配置轮询负载均衡器
    let idp_lb = Arc::new(LoadBalancer::try_from_iter([idp_upstream.as_str()]).unwrap());
    let portal_lb = Arc::new(LoadBalancer::try_from_iter([portal_upstream.as_str()]).unwrap());

    // 构建 HTTPS 反向代理服务（含 JWT 验签）
    let mut gateway_proxy = http_proxy_service(
        &my_server.configuration,
        Gateway {
            idp_lb,
            portal_lb,
            jwks_cache: Arc::clone(&jwks_cache),
            idp_issuer,
        },
    );

    let tls_settings = TlsSettings::intermediate(&cert_path, &key_path)
        .expect("❌ 加载 TLS 证书失败，请检查路径是否正确挂载");

    let ssl_bind_address = format!("0.0.0.0:{}", ssl_port);
    gateway_proxy.add_tls_with_settings(&ssl_bind_address, None, tls_settings);
    my_server.add_service(gateway_proxy);
    info!("✅ HTTPS 代理服务监听于: {}", ssl_bind_address);

    // HTTP → HTTPS 强制重定向服务
    struct RedirectService {
        ssl_port: String,
    }
    #[async_trait]
    impl ProxyHttp for RedirectService {
        type CTX = ();
        fn new_ctx(&self) -> Self::CTX {}

        async fn request_filter(&self, session: &mut Session, _ctx: &mut ()) -> Result<bool> {
            let host = session
                .get_header("Host")
                .and_then(|h| h.to_str().ok())
                .unwrap_or("unknown");
            let uri = session.req_header().uri.path();
            let host_only = host.split(':').next().unwrap_or(host);
            let location = if self.ssl_port == "443" {
                format!("https://{}{}", host_only, uri)
            } else {
                format!("https://{}:{}{}", host_only, self.ssl_port, uri)
            };

            info!("HTTP → HTTPS 重定向: {}", location);
            let mut header = ResponseHeader::build(301, None).unwrap();
            header.insert_header("Location", location).unwrap();
            session.set_keepalive(None);
            session.write_response_header(Box::new(header), true).await?;
            Ok(true)
        }

        async fn upstream_peer(
            &self,
            _session: &mut Session,
            _ctx: &mut (),
        ) -> Result<Box<HttpPeer>> {
            unreachable!()
        }
    }

    let mut redirect_proxy = http_proxy_service(
        &my_server.configuration,
        RedirectService { ssl_port: ssl_port.clone() },
    );
    let http_bind_address = format!("0.0.0.0:{}", redirect_port);
    redirect_proxy.add_tcp(&http_bind_address);
    my_server.add_service(redirect_proxy);
    info!("✅ HTTP 重定向服务监听于: {}", http_bind_address);

    info!("🚀 SSO 去中心化网关已完全就绪，开始处理流量...");
    my_server.run_forever();
}
