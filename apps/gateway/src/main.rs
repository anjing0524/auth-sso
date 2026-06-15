mod claims;
mod config;
mod gateway;
mod jwks;
mod redirect;

use crate::config::Config;
use crate::gateway::Gateway;
use crate::jwks::JwksCache;
use crate::redirect::RedirectService;
use log::{error, info, warn};
use pingora_core::listeners::tls::TlsSettings;
use pingora_core::prelude::*;
use pingora_load_balancing::LoadBalancer;
use pingora_proxy::http_proxy_service;
use std::env;
use std::sync::Arc;

/// Auth-SSO 去中心化安全网关 - 基于 Pingora (0.8.0 + OpenSSL)
fn main() {
    env_logger::init();
    info!("🚀 SSO 去中心化安全网关启动中 (Pingora 0.8.0 + ES256 JWKS 验签)...");

    // ── 读取配置文件（支持命令行参数指定，默认为 gateway.toml） ──
    let config_path = env::args()
        .nth(1)
        .unwrap_or_else(|| "gateway.toml".to_string());
    let config = Config::load(&config_path);

    info!("配置加载完成:");
    info!("  网关监听端口 (HTTP): {}", config.gateway.port);
    info!("  网关监听端口 (HTTPS): {}", config.gateway.ssl_port);
    info!("  SSL 证书路径: {}", config.gateway.ssl_cert_path);
    info!("  Portal 上游: {}", config.portal.upstream);
    info!("  JWKS URL: {}", config.portal.jwks_url);
    info!("  Issuer: {}", config.portal.issuer);

    // ── 初始化 JWKS 公钥缓存 ──
    let jwks_cache = JwksCache::new();

    // 启动 tokio 运行时以支持 JWKS 后台刷新任务
    let rt = tokio::runtime::Runtime::new().expect("tokio Runtime 初始化失败");

    // 启动 JWKS 后台定时刷新任务（每 5 分钟拉取一次，支持 Portal 密钥轮换）
    let cache_for_task = Arc::clone(&jwks_cache);
    let jwks_url_clone = config.portal.jwks_url.clone();
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
    let jwks_url_first = config.portal.jwks_url.clone();
    rt.block_on(async {
        for attempt in 1..=5 {
            match jwks_cache.refresh(&jwks_url_first).await {
                Ok(_) => {
                    info!("✅ 首次 JWKS 公钥加载成功（第 {} 次尝试）", attempt);
                    break;
                }
                Err(e) => {
                    warn!(
                        "⚠️  首次 JWKS 加载失败（第 {} 次）: {:?}，2 秒后重试",
                        attempt, e
                    );
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
            }
        }
    });

    // ── 初始化 Pingora 服务器 ──
    let mut my_server = Server::new(None).unwrap();
    my_server.bootstrap();

    // 配置 Portal 上游负载均衡器（Portal 已合并 IdP，统一代理入口）
    let portal_lb =
        Arc::new(LoadBalancer::try_from_iter([config.portal.upstream.as_str()]).unwrap());

    // 构建 HTTPS 反向代理服务（含 JWT 验签）
    let mut gateway_proxy = http_proxy_service(
        &my_server.configuration,
        Gateway {
            portal_lb,
            jwks_cache: Arc::clone(&jwks_cache),
            issuer: config.portal.issuer.clone(),
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
            ssl_port: config.gateway.ssl_port.to_string(),
        },
    );
    let http_bind_address = format!("0.0.0.0:{}", config.gateway.port);
    redirect_proxy.add_tcp(&http_bind_address);
    my_server.add_service(redirect_proxy);
    info!("✅ HTTP 重定向服务监听于: {}", http_bind_address);

    info!("🚀 SSO 去中心化网关已完全就绪，开始处理流量...");
    my_server.run_forever();
}
