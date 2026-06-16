mod claims;
mod config;
mod gateway;
mod jwks;
mod redirect;

use crate::config::Config;
use crate::gateway::Gateway;
use crate::jwks::JwksCache;
use crate::redirect::RedirectService;
use clap::Parser;
use log::{error, info, warn};
use pingora_core::listeners::tls::TlsSettings;
use pingora_core::prelude::*;
use pingora_load_balancing::LoadBalancer;
use pingora_proxy::http_proxy_service;
use std::sync::Arc;

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

/// 启动 JWKS 后台定时刷新任务，具备空缓存高频重试和成功缓存正常退避机制
fn start_jwks_background_refresh_task(
    rt: &tokio::runtime::Runtime,
    jwks_cache: Arc<JwksCache>,
    jwks_url: String,
) {
    rt.spawn(async move {
        // 定时拉取前，仅在后台任务刚启动时，先休眠一次以错开冷启动首次拉取阶段
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;

        loop {
            match jwks_cache.refresh(&jwks_url).await {
                Ok(_) => {
                    info!("✅ JWKS 公钥缓存定时刷新成功");
                    tokio::time::sleep(std::time::Duration::from_secs(300)).await;
                }
                Err(e) => {
                    error!("❌ JWKS 公钥缓存定时刷新失败: {}", e);
                    // 仅在刷新失败时，才获取读锁判定当前是否已有旧公钥，决定是快速重试还是正常退避
                    let has_keys = !jwks_cache.is_empty();
                    let sleep_secs = if has_keys { 300 } else { 10 };
                    warn!("⚠️ 网关将在 {} 秒后重试拉取 JWKS...", sleep_secs);
                    tokio::time::sleep(std::time::Duration::from_secs(sleep_secs)).await;
                }
            }
        }
    });
}

/// Auth-SSO 去中心化安全网关 - 基于 Pingora (0.8.0 + OpenSSL)
fn main() {
    env_logger::init();
    info!("🚀 SSO 去中心化安全网关启动中 (Pingora 0.8.0 + ES256 JWKS 验签)...");

    // ── 声明式命令行参数解析 ──
    let cli = Cli::parse();
    let config = Config::load(&cli.config);

    info!("配置加载完成:");
    info!("  网关监听端口 (HTTP): {}", config.gateway.port);
    info!("  网关监听端口 (HTTPS): {}", config.gateway.ssl_port);
    info!("  SSL 证书路径: {}", config.gateway.ssl_cert_path);
    info!("  Portal 上游: {}", config.portal.upstream);
    info!("  JWKS URL: {}", config.portal.jwks_url);
    info!("  Issuer: {}", config.portal.issuer);

    // ── 初始化 JWKS 公钥缓存 ──
    let jwks_cache = JwksCache::new();

    // 启动 tokio 运行时以支持 JWKS 定时刷新任务
    let rt = tokio::runtime::Runtime::new().expect("❌ tokio Runtime 初始化失败");

    // ── 阻塞等待首次 JWKS 刷新完成（最多等待 10 秒），确保网关启动时公钥就绪 ──
    let jwks_url_first = config.portal.jwks_url.clone();
    let jwks_cache_first = Arc::clone(&jwks_cache);
    rt.block_on(async {
        for attempt in 1..=5 {
            match jwks_cache_first.refresh(&jwks_url_first).await {
                Ok(_) => {
                    info!("✅ 首次 JWKS 公钥加载成功（第 {} 次尝试）", attempt);
                    break;
                }
                Err(e) => {
                    warn!(
                        "⚠️  首次 JWKS 加载失败（第 {} 次）: {}，2 秒后重试",
                        attempt, e
                    );
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
            }
        }
    });

    // ── 启动 JWKS 后台定时刷新任务 ──
    start_jwks_background_refresh_task(
        &rt,
        Arc::clone(&jwks_cache),
        config.portal.jwks_url.clone(),
    );

    // ── 初始化 Pingora 服务器 ──
    let mut my_server = Server::new(None).expect("❌ 创建 Pingora 服务器失败");
    my_server.bootstrap();

    // 配置 Portal 上游负载均衡器（Portal 已合并 IdP，统一代理入口）
    let portal_lb = Arc::new(
        LoadBalancer::try_from_iter([config.portal.upstream.as_str()])
            .expect("❌ 配置的 Portal 上游地址无效"),
    );

    // 预分类公开白名单路径，将精确匹配（哈希检索）和前缀放行分类，实现 O(1) 路由查询性能
    let mut public_exact_paths = std::collections::HashSet::new();
    let mut public_prefix_paths = Vec::new();
    for path in config.portal.public_paths.clone().unwrap_or_default() {
        if path.ends_with('/') && path != "/" {
            public_prefix_paths.push(path);
        } else {
            public_exact_paths.insert(path);
        }
    }
    // 性能优化：对前缀路径按长度进行降序排序，使较长且具体的路径匹配在循环中尽早触发命中
    public_prefix_paths.sort_by_key(|p| std::cmp::Reverse(p.len()));

    // 构建 HTTPS 反向代理服务（含 JWT 验签）
    let mut gateway_proxy = http_proxy_service(
        &my_server.configuration,
        Gateway {
            portal_lb,
            jwks_cache: Arc::clone(&jwks_cache),
            issuer: config.portal.issuer.clone(),
            public_exact_paths,
            public_prefix_paths,
        },
    );

    let tls_settings =
        TlsSettings::intermediate(&config.gateway.ssl_cert_path, &config.gateway.ssl_key_path)
            .expect("❌ 加载 TLS 证书失败，请检查路径是否正确挂载");

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
}
