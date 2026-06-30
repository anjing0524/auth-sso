use anyhow::Context;
use clap::Parser;
use pingora_core::listeners::tls::TlsSettings;
use pingora_core::prelude::*;
use pingora_core::services::background::background_service;
use pingora_load_balancing::LoadBalancer;
use pingora_proxy::http_proxy_service;
use std::sync::Arc;
use tracing::info;

use gateway::auth::{JwtVerifier, TokenRefresher};
use gateway::config::{Config, Upstreams};
use gateway::gateway::Gateway;
use gateway::jwks::JwksCache;
use gateway::path_matcher::PathMatcher;
use gateway::redirect::RedirectService;

/// 命令行参数解析结构体 (Clap 声明式解析)
#[derive(Parser, Debug)]
#[command(
    name = "gateway",
    author = "Auth-SSO Team",
    version = "0.1.0",
    about = "SSO 去中心化安全网关 - 基于 Pingora + 密码学离线验签"
)]
struct Cli {
    /// 配置文件路径
    #[arg(short, long, default_value = "gateway.toml")]
    config: String,
}

fn main() -> anyhow::Result<()> {
    // ── 声明式命令行参数解析 ──
    let cli = Cli::parse();
    let config = Config::load(&cli.config).context("❌ 无法加载网关配置文件")?;

    // ── 初始化 Tracing 日志系统 (控制台 + 每日滚动文件) ──
    let _guard = gateway::logging::init_tracing(&config.gateway.log_dir, &config.gateway.log_level);

    info!("🚀 SSO 去中心化安全网关启动中 (Pingora 0.8.0 + ES256 JWKS 验签)...");

    // ── 构建共享组件 ──
    let upstreams = Arc::new(Upstreams::from_config(&config.portal.upstream));

    // 快速失败：空 upstream 配置无法处理任何请求
    if upstreams.is_empty() {
        anyhow::bail!(
            "❌ 未配置任何 Portal 上游地址（portal.upstream 为空），请在配置文件中设置有效的 upstream"
        );
    }

    let jwks_cache = Arc::new(JwksCache::new());
    let jwt_verifier = JwtVerifier::new(Arc::clone(&jwks_cache));
    let token_refresher = TokenRefresher::new(Arc::clone(&jwks_cache), Arc::clone(&upstreams));
    let portal_lb = Arc::new(
        LoadBalancer::try_from_iter(upstreams.iter())
            .map_err(|e| anyhow::anyhow!("配置 Portal 上游负载均衡器失败: {:?}", e))?,
    );
    let path_matcher = PathMatcher::new(config.portal.public_paths.clone());

    info!("配置加载完成:");
    info!("  网关监听端口 (HTTP): {}", config.gateway.port);
    info!("  网关监听端口 (HTTPS): {}", config.gateway.ssl_port);
    info!("  SSL 证书路径: {}", config.gateway.ssl_cert_path);
    info!(
        "  Portal 上游负载均衡 ({} 个节点): {:?}",
        upstreams.len(),
        upstreams
    );

    // ── Pingora 服务器启动 ──
    let mut my_server = Server::new(None).context("❌ 创建 Pingora 服务器失败")?;
    my_server.bootstrap();

    // ── Redis 初始化 Service（利用 Pingora Service 生命周期预热连接，失败直接 exit）──
    let redis_init_svc = background_service(
        "Redis Init",
        gateway::redis::RedisInitService::new(config.redis.url.clone()),
    );
    let redis_handle = my_server.add_service(redis_init_svc);

    // ── 注册 JWKS 后台定时刷新服务（逐个尝试 upstream 直到 OIDC Discovery 成功）──
    let jwks_refresh_svc = background_service(
        "JWKS Refresh Service",
        gateway::jwks::JwksRefreshService::new(Arc::clone(&jwks_cache), Arc::clone(&upstreams)),
    );
    let _ = my_server.add_service(jwks_refresh_svc);

    // ── Gateway 代理服务（精准依赖注入，无上帝对象）──
    let mut gateway_proxy = http_proxy_service(
        &my_server.configuration,
        Gateway::new(path_matcher, portal_lb, jwt_verifier, token_refresher),
    );

    let mut tls_settings =
        TlsSettings::intermediate(&config.gateway.ssl_cert_path, &config.gateway.ssl_key_path)
            .context("❌ 加载 TLS 证书失败，请检查路径是否正确挂载")?;
    // 开启 HTTP/2 (h2) ALPN 协商，优先 h2，回退 http/1.1
    tls_settings.enable_h2();

    let ssl_bind_address = format!("0.0.0.0:{}", config.gateway.ssl_port);
    gateway_proxy.add_tls_with_settings(&ssl_bind_address, None, tls_settings);
    let gateway_handle = my_server.add_service(gateway_proxy);
    gateway_handle.add_dependency(&redis_handle);
    info!("✅ HTTPS 代理服务监听于: {}", ssl_bind_address);

    // HTTP → HTTPS 强制重定向服务
    let mut redirect_proxy = http_proxy_service(
        &my_server.configuration,
        RedirectService::new(config.gateway.ssl_port),
    );
    let http_bind_address = format!("0.0.0.0:{}", config.gateway.port);
    redirect_proxy.add_tcp(&http_bind_address);
    let _ = my_server.add_service(redirect_proxy);
    info!("✅ HTTP 重定向服务监听于: {}", http_bind_address);

    info!("🚀 SSO 去中心化网关已完全就绪，开始处理流量...");
    my_server.run_forever();
}
