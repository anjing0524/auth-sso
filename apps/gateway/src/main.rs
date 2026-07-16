use anyhow::Context;
use clap::Parser;
use pingora_core::listeners::tls::TlsSettings;
use pingora_core::prelude::*;
use pingora_core::services::background::background_service;
use pingora_load_balancing::LoadBalancer;
use pingora_load_balancing::selection::RoundRobin;
use pingora_proxy::http_proxy_service;
use std::sync::Arc;
use tracing::info;

use gateway::auth::{JwtVerifier, TokenRefresher};
use gateway::config::{Config, Upstreams};
use gateway::gateway::Gateway;
use gateway::jwks::JwksCache;
use gateway::path_matcher::PathMatcher;
use gateway::redirect::RedirectService;
use gateway::router::Router;

#[derive(Parser, Debug)]
#[command(name = "gateway", author, version, about = "SSO 去中心化安全网关")]
struct Cli {
    #[arg(short, long, default_value = "gateway.toml")]
    config: String,
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let config = Config::load(&cli.config).context("❌ 无法加载网关配置文件")?;

    let _guard = gateway::logging::init_tracing(&config.gateway.log_dir, &config.gateway.log_level);
    info!("🚀 SSO 去中心化安全网关启动中 (Pingora 0.8.0 + ES256 JWKS 验签)...");

    let upstream_routes = &config.upstreams;
    gateway::config::validate_routing_consistency(upstream_routes)
        .context("❌ 路由配置一致性校验失败")?;

    let oidc_entry = upstream_routes
        .iter()
        .find(|u| u.oidc_provider)
        .expect("validate_routing_consistency 应已保证存在 oidc_provider = true 的 upstream");
    let portal_upstreams = Arc::new(Upstreams::from_config(&oidc_entry.addresses));

    if portal_upstreams.is_empty() {
        anyhow::bail!(
            "❌ OIDC Provider upstream \"{}\" 未配置有效地址",
            oidc_entry.name
        );
    }

    let jwks_cache = Arc::new(JwksCache::new());
    let jwt_verifier = JwtVerifier::new(Arc::clone(&jwks_cache));
    let token_refresher =
        TokenRefresher::new(Arc::clone(&jwks_cache), Arc::clone(&portal_upstreams));

    let mut entries: Vec<(String, Arc<LoadBalancer<RoundRobin>>)> = Vec::new();
    for uc in upstream_routes {
        let ups = Upstreams::from_config(&uc.addresses);
        if ups.is_empty() {
            anyhow::bail!("❌ upstream \"{}\" 未配置有效地址", uc.name);
        }
        let lb = Arc::new(LoadBalancer::try_from_iter(ups.iter()).map_err(|e| {
            anyhow::anyhow!("配置 upstream \"{}\" 负载均衡器失败: {:?}", uc.name, e)
        })?);
        entries.push((uc.name.clone(), lb));
    }
    let router = Router::new(entries);

    let all_public_paths: Vec<String> = upstream_routes
        .iter()
        .flat_map(|u| u.public_paths.iter().cloned())
        .collect();
    let path_matcher = PathMatcher::new(all_public_paths);

    let default_upstream_name = upstream_routes
        .first()
        .map(|u| u.name.clone())
        .unwrap_or_else(|| "/".to_string());

    info!("配置加载完成:");
    info!(
        "  HTTP: {}  HTTPS: {}",
        config.gateway.port, config.gateway.ssl_port
    );
    info!(
        "  OIDC upstream ({} 个节点): {:?}",
        portal_upstreams.len(),
        portal_upstreams
    );
    info!("  路由表 ({} 条 upstream):", upstream_routes.len());
    for uc in upstream_routes {
        info!("    {} → {}", uc.name, uc.addresses);
    }
    info!("  默认 upstream: {}", default_upstream_name);

    let mut my_server = Server::new(None).context("❌ 创建 Pingora 服务器失败")?;
    my_server.bootstrap();

    let redis_init_svc = background_service(
        "Redis Init",
        gateway::redis::RedisInitService::new(config.redis.clone()),
    );
    let redis_handle = my_server.add_service(redis_init_svc);

    let jwks_refresh_svc = background_service(
        "JWKS Refresh Service",
        gateway::jwks::JwksRefreshService::new(
            Arc::clone(&jwks_cache),
            Arc::clone(&portal_upstreams),
            config.gateway.jwks_refresh_interval_secs,
        ),
    );
    let _ = my_server.add_service(jwks_refresh_svc);

    let mut gateway_proxy = http_proxy_service(
        &my_server.configuration,
        Gateway::new(
            path_matcher,
            router,
            jwt_verifier,
            token_refresher,
            upstream_routes
                .iter()
                .map(|uc| (uc.name.clone(), uc.oauth.clone()))
                .collect(),
            portal_upstreams,
            config.gateway.gateway_shared_secret.clone(),
            config.gateway.upstream_scheme.clone(),
        ),
    );

    let mut tls_settings =
        TlsSettings::intermediate(&config.gateway.ssl_cert_path, &config.gateway.ssl_key_path)
            .context("❌ 加载 TLS 证书失败")?;
    tls_settings.enable_h2();

    gateway_proxy.add_tls_with_settings(
        &format!("0.0.0.0:{}", config.gateway.ssl_port),
        None,
        tls_settings,
    );
    let gateway_handle = my_server.add_service(gateway_proxy);
    gateway_handle.add_dependency(&redis_handle);
    info!(
        "✅ HTTPS 代理服务监听于: 0.0.0.0:{}",
        config.gateway.ssl_port
    );

    let mut redirect_proxy = http_proxy_service(
        &my_server.configuration,
        RedirectService::new(config.gateway.ssl_port),
    );
    redirect_proxy.add_tcp(&format!("0.0.0.0:{}", config.gateway.port));
    let _ = my_server.add_service(redirect_proxy);
    info!("✅ HTTP 重定向服务监听于: 0.0.0.0:{}", config.gateway.port);

    info!("🚀 SSO 去中心化网关已完全就绪");
    my_server.run_forever();
}
