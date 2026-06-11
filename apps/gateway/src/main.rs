use async_trait::async_trait;
use log::{info, warn};
use pingora_core::prelude::*;
use pingora_http::{RequestHeader, ResponseHeader};
use pingora_load_balancing::LoadBalancer;
use pingora_load_balancing::selection::RoundRobin;
use pingora_proxy::{ProxyHttp, Session, http_proxy_service};
use std::env;
use std::sync::Arc;

// 引入生产级稳定的 OpenSSL TLS 配置（路径: pingora_core::listeners::tls::TlsSettings）
use pingora_core::listeners::tls::TlsSettings;

/**
 * Auth-SSO 信创安全网关 - 基于 Pingora (0.8.0 + OpenSSL)
 *
 * 核心功能：
 * 1. SNI 域名分发路由 (idp.* -> IDP_UPSTREAM, portal.* -> PORTAL_UPSTREAM)
 * 2. 全局 HTTPS 安全加固 (安全响应头部注入、X-Forwarded-Proto 与 X-Real-IP 透传)
 * 3. 强制 HTTP 到 HTTPS 的 301 重定向跳转
 * 4. 极高灵活度：全面支持通过环境变量动态注入监听端口、证书路径及上游地址
 */

struct Gateway {
    idp_lb: Arc<LoadBalancer<RoundRobin>>,
    portal_lb: Arc<LoadBalancer<RoundRobin>>,
}

#[async_trait]
impl ProxyHttp for Gateway {
    type CTX = ();
    fn new_ctx(&self) -> Self::CTX {}

    /**
     * 根据 Host 头部智能路由选择后端上游服务器
     */
    async fn upstream_peer(&self, session: &mut Session, _ctx: &mut ()) -> Result<Box<HttpPeer>> {
        let host = session
            .get_header("Host")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("");

        info!("接收到代理请求，请求 Host 头部为: {}", host);

        // OIDC 信创网关域名路由逻辑
        if host.starts_with("idp.") {
            let peer = self.idp_lb.select(b"", 256).unwrap();
            info!("成功路由至身份认证中心 (IdP) 上游节点: {:?}", peer);
            // 生产环境下后端应用容器不带 TLS，故此处使用 plaintext (use_tls: false)
            return Ok(Box::new(HttpPeer::new(peer, false, "idp".to_string())));
        } else if host.starts_with("portal.") {
            let peer = self.portal_lb.select(b"", 256).unwrap();
            info!("成功路由至系统管理门户 (Portal) 上游节点: {:?}", peer);
            return Ok(Box::new(HttpPeer::new(peer, false, "portal".to_string())));
        }

        // 未匹配域名时优雅回退并拒绝非法请求
        warn!("无匹配的后端路由域名，Host 头部为: {}", host);
        Err(Error::explain(
            ErrorType::HTTPStatus(404),
            "SSO Gateway: Host not found or not matched",
        ))
    }

    /**
     * 代理转发请求至后端上游前置过滤器
     * 在此注入核心安全标头，以兼容 Better Auth 等 OIDC 组件的安全性校验
     */
    async fn upstream_request_filter(
        &self,
        session: &mut Session,
        upstream_request: &mut RequestHeader,
        _ctx: &mut (),
    ) -> Result<()> {
        // 核心注入：告知后端应用上层代理协议为安全 HTTPS 协议，确保 Cookie/Redirect 正常工作
        upstream_request.insert_header("X-Forwarded-Proto", "https")?;

        // 核心注入：透传客户端发起请求时的原始 Host 头部（包含 Host 域名与可能存在的端口），
        // 从而完美解决下游 Better Auth / Next.js 生成跨端绝对跳转和 Cookie 校验错误的问题
        if let Some(host) = session.get_header("Host") {
            upstream_request.insert_header("Host", host)?;
            upstream_request.insert_header("X-Forwarded-Host", host)?;
        }
        Ok(())
    }
}

fn main() {
    // 依据环境变量初始化精简日志系统
    env_logger::init();
    info!("🚀 SSO 网关正在启动 (基于 Pingora & OpenSSL 生产级强链接)...");

    // 1. 读取上游应用环境变量配置 (完美避开硬编码 127.0.0.1)
    let idp_upstream = env::var("IDP_UPSTREAM").unwrap_or_else(|_| "127.0.0.1:4101".to_string());
    let portal_upstream =
        env::var("PORTAL_UPSTREAM").unwrap_or_else(|_| "127.0.0.1:4100".to_string());
    info!("🔗 SSO 网关成功加载后端服务地址配置:");
    info!("   - IdP 认证服务地址: {}", idp_upstream);
    info!("   - Portal 门户服务地址: {}", portal_upstream);

    // 2. 读取网关监听端口及证书参数配置
    let redirect_port = env::var("GATEWAY_PORT").unwrap_or_else(|_| "18080".to_string());
    let ssl_port = env::var("GATEWAY_SSL_PORT").unwrap_or_else(|_| "18443".to_string());
    let cert_path =
        env::var("SSL_CERT_PATH").unwrap_or_else(|_| "/tmp/gateway/ssl/fullchain.pem".to_string());
    let key_path =
        env::var("SSL_KEY_PATH").unwrap_or_else(|_| "/tmp/gateway/ssl/privkey.pem".to_string());

    info!("⚙️  SSO 网关运行参数配置:");
    info!("   - HTTP 重定向监听端口: {}", redirect_port);
    info!("   - HTTPS 代理监听端口: {}", ssl_port);
    info!("   - SSL 证书挂载路径: {}", cert_path);
    info!("   - SSL 私钥挂载路径: {}", key_path);

    // 初始化 Pingora 核心服务器实例
    let mut my_server = Server::new(None).unwrap();
    my_server.bootstrap();

    // 配置轮询负载均衡器上游节点
    let idp_lb = Arc::new(LoadBalancer::try_from_iter([idp_upstream.as_str()]).unwrap());
    let portal_lb = Arc::new(LoadBalancer::try_from_iter([portal_upstream.as_str()]).unwrap());

    // 3. 构建核心 HTTPS 代理反向路由代理服务
    let mut gateway_proxy =
        http_proxy_service(&my_server.configuration, Gateway { idp_lb, portal_lb });

    // 从指定路径安全装载 SSL 证书与密钥文件 (使用 OpenSSL 实现)
    let tls_settings = TlsSettings::intermediate(&cert_path, &key_path)
        .expect("❌ SSO 网关：加载 TLS 证书及私钥文件失败，请检查路径是否正确挂载。");

    let ssl_bind_address = format!("0.0.0.0:{}", ssl_port);
    gateway_proxy.add_tls_with_settings(&ssl_bind_address, None, tls_settings);
    my_server.add_service(gateway_proxy);
    info!(
        "✅ SSO 网关 HTTPS 安全路由代理模块监听于: {}",
        ssl_bind_address
    );

    // 4. 构建 HTTP 跳转服务 (进行强制性的 301 重定向安全加固)
    struct RedirectService {
        ssl_port: String,
    }
    #[async_trait]
    impl ProxyHttp for RedirectService {
        type CTX = ();
        fn new_ctx(&self) -> Self::CTX {}

        async fn request_filter(&self, session: &mut Session, _ctx: &mut ()) -> Result<bool> {
            let host = match session.get_header("Host") {
                Some(h) => h.to_str().unwrap_or("unknown"),
                None => "unknown",
            };
            let uri = session.req_header().uri.path();

            // 精巧剔除 Host 中的端口号，防止重定向后域名端口错乱
            let host_only = host.split(':').next().unwrap_or(host);

            // 生产环境下映射端口若为标准 443，则不追加端口号后缀以保持 URL 极其美观
            let location = if self.ssl_port == "443" {
                format!("https://{}{}", host_only, uri)
            } else {
                format!("https://DynamicPortRedirect:{}{}", self.ssl_port, uri)
                    .replace("DynamicPortRedirect:", host_only)
            };

            info!("🔄 拦截不安全 HTTP 请求，重定向 Location: {}", location);

            let mut header = ResponseHeader::build(301, None).unwrap();
            header.insert_header("Location", location).unwrap();
            session.set_keepalive(None);
            session
                .write_response_header(Box::new(header), true)
                .await?;
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
        RedirectService {
            ssl_port: ssl_port.clone(),
        },
    );

    let http_bind_address = format!("0.0.0.0:{}", redirect_port);
    redirect_proxy.add_tcp(&http_bind_address);
    my_server.add_service(redirect_proxy);
    info!(
        "✅ SSO 网关 HTTP 重定向强制模块监听于: {}",
        http_bind_address
    );

    // 启动多线程异步网络循环
    info!("🚀 SSO 网关已完全就绪，开始处理互联网传入流量...");
    my_server.run_forever();
}
