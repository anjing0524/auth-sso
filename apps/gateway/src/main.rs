mod claims;
mod config;
mod gateway;
mod jwks;
mod logging;
mod redirect;

use crate::config::Config;
use crate::gateway::{Gateway, PathMatcher};
use crate::jwks::JwksCache;
use crate::redirect::RedirectService;
use clap::Parser;
use pingora_core::listeners::tls::TlsSettings;
use pingora_core::prelude::*;
use pingora_load_balancing::LoadBalancer;
use pingora_proxy::http_proxy_service;
use std::sync::{Arc, Mutex};
use tracing::{error, info, warn};

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

/// Auth-SSO 去中心化安全网关 - 基于 Pingora (0.8.0 + OpenSSL)
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

    // ── 初始化 JWKS 公钥缓存 ──
    let jwks_cache = JwksCache::new();

    // 启动 tokio 运行时以支持 JWKS 定时刷新任务
    let rt = tokio::runtime::Runtime::new().context("❌ tokio Runtime 初始化失败")?;

    // ── 阻塞等待首次 JWKS 刷新完成（通过 OIDC Discovery 自动发现 JWKS 端点），最多等待 10 秒，确保网关启动时公钥就绪 ──
    let upstream_first = config.portal.upstream.clone();
    let jwks_cache_first = Arc::clone(&jwks_cache);
    rt.block_on(async {
        let mut loaded = false;
        for attempt in 1..=5 {
            match jwks_cache_first.refresh(&upstream_first).await {
                Ok(_) => {
                    info!("✅ 首次 JWKS 公钥加载成功（第 {} 次尝试）", attempt);
                    loaded = true;
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
        if !loaded {
            error!("❌ 首次 JWKS 公钥加载失败：5 次重试后仍无法获取公钥，网关退出");
            std::process::exit(1);
        }
    });

    // ── issuer 由 OIDC Discovery 自动获取 ──
    let effective_issuer = jwks_cache.get_discovered_issuer().unwrap_or_else(|| {
        warn!("⚠️ OIDC 元数据中无 issuer，回退到默认值");
        "http://localhost:4100".to_string()
    });
    info!("✅ issuer: {}", effective_issuer);

    // ── 启动 JWKS 后台定时刷新任务（通过 OIDC Discovery 自动发现端点）──
    Arc::clone(&jwks_cache).start_background_refresh(&rt, config.portal.upstream.clone());

    // ── 初始化 Redis 异步连接管理器（用于 jti 黑名单校验，自愈 fail-open） ──
    let redis_conn = match redis::Client::open(config.redis.url.as_str()) {
        Ok(client) => {
            // 利用网关已有的 tokio 运行时异步创建连接管理器
            match rt.block_on(async { client.get_connection_manager().await }) {
                Ok(conn) => {
                    info!(
                        "✅ 成功连接至 Redis ({}) 并成功构建异步多路复用连接管理器",
                        config.redis.url
                    );
                    Some(conn)
                }
                Err(e) => {
                    error!(
                        "❌ 创建 Redis 异步连接管理器失败: {}。网关安全策略将进行降级 (fail-open)",
                        e
                    );
                    None
                }
            }
        }
        Err(e) => {
            error!(
                "❌ 无法解析配置的 Redis 连接 URL: {}，错误: {}。网关安全策略将进行降级 (fail-open)",
                config.redis.url, e
            );
            None
        }
    };

    // ── 初始化 Pingora 服务器 ──
    let mut my_server = Server::new(None).context("❌ 创建 Pingora 服务器失败")?;
    my_server.bootstrap();

    // 配置 Portal 上游负载均衡器（Portal 已合并 IdP，统一代理入口）
    let portal_lb = Arc::new(
        LoadBalancer::try_from_iter([config.portal.upstream.as_str()])
            .context("❌ 配置的 Portal 上游地址无效")?,
    );

    let path_matcher = PathMatcher::new(config.portal.public_paths.clone());

    // 构建异步 HTTP 客户端（用于向 Portal 发起 token 续签请求）
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .context("❌ 创建 HTTP 客户端失败")?;

    // 构建 HTTPS 反向代理服务（含 JWT 验签、静默续签、Redis jti 黑名单校验）
    let mut gateway_proxy = http_proxy_service(
        &my_server.configuration,
        Gateway {
            portal_lb,
            jwks_cache: Arc::clone(&jwks_cache),
            issuer: effective_issuer,
            path_matcher,
            redis_conn,
            http_client,
            upstream_addr: config.portal.upstream.clone(),
            refresh_dedup: Mutex::new(std::collections::HashMap::new()),
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
