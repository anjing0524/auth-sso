mod auth;
mod claims;
mod config;
mod cookie;
mod gateway;
mod jwks;
mod logging;
mod path_matcher;
mod rate_limiter;
mod redirect;
mod redis;

use crate::auth::AuthService;
use crate::config::Config;
use crate::gateway::Gateway;
use crate::jwks::JwksCache;
use crate::path_matcher::PathMatcher;
use crate::rate_limiter::RateLimiter;
use crate::redirect::RedirectService;
use clap::Parser;
use pingora_core::listeners::tls::TlsSettings;
use pingora_core::prelude::*;
use pingora_load_balancing::LoadBalancer;
use pingora_proxy::http_proxy_service;
use std::sync::Arc;
use tracing::info;

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

use anyhow::Context;

fn main() -> anyhow::Result<()> {
    // ── 声明式命令行参数解析 ──
    let cli = Cli::parse();
    let config = Config::load(&cli.config).context("❌ 无法加载网关配置文件")?;

    // ── 初始化 Tracing 日志系统 (控制台 + 每日滚动文件) ──
    let _guard = logging::init_tracing(&config.gateway.log_dir, &config.gateway.log_level);

    info!("🚀 SSO 去中心化安全网关启动中 (Pingora 0.8.0 + ES256 JWKS 验签)...");

    info!("配置加载完成:");
    info!("  网关监听端口 (HTTP): {}", config.gateway.port);
    info!("  网关监听端口 (HTTPS): {}", config.gateway.ssl_port);
    info!("  SSL 证书路径: {}", config.gateway.ssl_cert_path);
    info!("  Portal 上游 (OIDC Discovery): {}", config.portal.upstream);

    // ═══════════════════════════════════════════════════════════════
    // 阶段 1：同步冷启动 — 无需阻塞等待外部服务
    // ═══════════════════════════════════════════════════════════════

    let upstream = config.portal.upstream.clone();

    // JWKS 缓存在后台异步拉取，不阻塞启动（缓存空时验签自然失败，Gateway 拒绝请求）
    let jwks_cache = Arc::new(JwksCache::new());

    // ═══════════════════════════════════════════════════════════════
    // 阶段 2：初始化 Pingora 运行时 → 启动后台任务 → 创建 Redis 连接池
    // ═══════════════════════════════════════════════════════════════

    let mut my_server = Server::new(None).context("❌ 创建 Pingora 服务器失败")?;
    my_server.bootstrap();
    // ── 创建用于网关后台任务（JWKS 刷新与 Redis 连接池）的独立 Tokio 运行时 ──
    let handle = pingora_runtime::current_handle();

    // ── 启动 JWKS 后台定时刷新（首次拉取立即执行，非阻塞）──
    Arc::clone(&jwks_cache).start_background_refresh(&handle, upstream.clone());

    // ── 同步创建 Redis 连接池（基础依赖，启动时即建；bb8::Pool 基于 Arc，clone 即共享）──
    let redis_pool = crate::redis::build_pool_blocking(&handle, config.redis.url.as_str());

    // ═══════════════════════════════════════════════════════════════
    // 阶段 3：组装服务并启动
    // ═══════════════════════════════════════════════════════════════

    let portal_lb = Arc::new(
        LoadBalancer::try_from_iter([upstream.as_str()])
            .context("❌ 配置的 Portal 上游地址无效")?,
    );

    let path_matcher = PathMatcher::new(config.portal.public_paths.clone());

    let auth_service = Arc::new(AuthService::new(
        Arc::clone(&jwks_cache),
        upstream.clone(),
        redis_pool.clone(),
    ));

    let mut gateway_proxy = http_proxy_service(
        &my_server.configuration,
        Gateway {
            portal_lb,
            auth_service,
            path_matcher,
            limiter: Arc::new(RateLimiter::new(redis_pool)),
        },
    );

    let tls_settings =
        TlsSettings::intermediate(&config.gateway.ssl_cert_path, &config.gateway.ssl_key_path)
            .context("❌ 加载 TLS 证书失败，请检查路径是否正确挂载")?;

    let ssl_bind_address = format!("0.0.0.0:{}", config.gateway.ssl_port);
    gateway_proxy.add_tls_with_settings(&ssl_bind_address, None, tls_settings);
    my_server.add_service(gateway_proxy);
    info!("✅ HTTPS 代理服务监听于: {}", ssl_bind_address);

    // HTTP → HTTPS 强制重定向服务
    let mut redirect_proxy = http_proxy_service(
        &my_server.configuration,
        RedirectService {
            ssl_port: config.gateway.ssl_port,
        },
    );
    let http_bind_address = format!("0.0.0.0:{}", config.gateway.port);
    redirect_proxy.add_tcp(&http_bind_address);
    my_server.add_service(redirect_proxy);
    info!("✅ HTTP 重定向服务监听于: {}", http_bind_address);

    info!("🚀 SSO 去中心化网关已完全就绪，开始处理流量...");
    my_server.run_forever();
    #[allow(unreachable_code)]
    Ok(())
}
