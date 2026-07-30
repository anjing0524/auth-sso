use anyhow::Context;
use clap::Parser;
use pingora_core::listeners::tls::TlsSettings;
use pingora_core::prelude::*;
use pingora_core::services::background::background_service;
use pingora_load_balancing::LoadBalancer;
use pingora_proxy::http_proxy_service;
use std::sync::Arc;
use tracing::info;

use gateway::acme::{AcmeChallengeStore, AcmeService, AcmeState};
use gateway::auth::{JwtVerifier, TokenRefresher};
use gateway::config::{Config, Upstreams};
use gateway::gateway::Gateway;
use gateway::jwks::JwksCache;
use gateway::path_matcher::PathMatcher;
use gateway::redirect::RedirectService;
use gateway::router::{RouteEntry, Router};
use gateway::tls::{TlsCertificateCallback, TlsCertificateStore};

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
    info!("🚀 SSO 去中心化安全网关启动中 (Pingora 0.8.1 + ACME + ES256 JWKS 验签)...");

    let upstream_routes = &config.upstreams;
    gateway::config::validate_routing_consistency(upstream_routes)
        .context("❌ 路由配置一致性校验失败")?;

    let oidc_entry = upstream_routes
        .iter()
        .find(|u| u.oidc_provider)
        .ok_or_else(|| anyhow::anyhow!("路由表缺少 oidc_provider = true 的 upstream（validate_routing_consistency 应已保证此点）"))?;
    let portal_upstreams = Arc::new(Upstreams::from_config(&oidc_entry.addresses));

    if portal_upstreams.is_empty() {
        anyhow::bail!(
            "❌ OIDC Provider upstream \"{}\" 未配置有效地址",
            oidc_entry.name
        );
    }

    let jwks_cache = Arc::new(JwksCache::new());
    let jwt_verifier = JwtVerifier::new(Arc::clone(&jwks_cache));
    let token_refresher = TokenRefresher::new(
        Arc::clone(&jwks_cache),
        Arc::clone(&portal_upstreams),
        config.gateway.upstream_scheme.clone(),
        config.gateway.gateway_shared_secret.clone(),
    );

    // 单一路由表：name/lb/oauth 一次装配（Router 内部按 prefix 长度降序排序）
    let mut entries: Vec<RouteEntry> = Vec::new();
    for uc in upstream_routes {
        let ups = Upstreams::from_config(&uc.addresses);
        if ups.is_empty() {
            anyhow::bail!("❌ upstream \"{}\" 未配置有效地址", uc.name);
        }
        let lb = Arc::new(LoadBalancer::try_from_iter(ups.iter()).map_err(|e| {
            anyhow::anyhow!("配置 upstream \"{}\" 负载均衡器失败: {:?}", uc.name, e)
        })?);
        entries.push(RouteEntry {
            prefix: uc.name.clone(),
            lb,
            oauth: uc.oauth.clone(),
        });
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
    if config.gateway.external_tls_termination {
        info!(
            "  平台 TLS 终结: HTTP 监听 {}（公网协议由平台保持为 HTTPS）",
            config.gateway.port
        );
    } else {
        info!(
            "  HTTP: {}  HTTPS: {}",
            config.gateway.port, config.gateway.ssl_port
        );
    }
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
            config.gateway.upstream_scheme.clone(),
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
            portal_upstreams,
            config.gateway.gateway_shared_secret.clone(),
            config.gateway.upstream_scheme.clone(),
            config.gateway.upstream_server_name.clone(),
            config.gateway.upstream_host_header.clone(),
            config.gateway.external_tls_termination,
            Arc::clone(&jwks_cache),
        ),
    );

    if config.gateway.external_tls_termination {
        gateway_proxy.add_tcp(&format!("0.0.0.0:{}", config.gateway.port));
        let gateway_handle = my_server.add_service(gateway_proxy);
        gateway_handle.add_dependency(&redis_handle);
        info!(
            "✅ 平台 TLS 终结代理服务监听于: 0.0.0.0:{}",
            config.gateway.port
        );
        info!("🚀 SSO 去中心化网关已就绪");
        my_server.run_forever();
    }

    let mut acme_runtime = None;
    let tls_store = if let Some(acme_config) = config.acme.clone() {
        let state = AcmeState::prepare(&acme_config).context("❌ 初始化 ACME 状态目录失败")?;
        let store = match state
            .load_certificate()
            .context("❌ 加载持久化 ACME 证书失败")?
        {
            Some((certificate, private_key)) => {
                TlsCertificateStore::from_pem(&certificate, &private_key)
                    .context("❌ 持久化 ACME 证书校验失败")?
            }
            None => TlsCertificateStore::empty(),
        };
        let challenges = Arc::new(AcmeChallengeStore::new());
        acme_runtime = Some((acme_config, state, challenges));
        Arc::new(store)
    } else {
        Arc::new(
            TlsCertificateStore::load(&config.gateway.ssl_cert_path, &config.gateway.ssl_key_path)
                .context("❌ 初始化 TLS 证书存储失败")?,
        )
    };
    let tls_ready_at_boot = tls_store.has_certificate();
    if tls_ready_at_boot {
        info!("✅ TLS 证书已加载");
    } else {
        info!("⏳ TLS 监听器以 ACME 引导模式启动，等待首张证书签发");
    }

    let mut tls_settings = TlsSettings::with_callbacks(Box::new(TlsCertificateCallback::new(
        Arc::clone(&tls_store),
    )))
    .context("❌ 创建动态 TLS 配置失败")?;
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

    let acme_challenges = acme_runtime
        .as_ref()
        .map(|(_, _, challenges)| Arc::clone(challenges));
    let mut redirect_proxy = http_proxy_service(
        &my_server.configuration,
        RedirectService::new(config.gateway.ssl_port, acme_challenges),
    );
    redirect_proxy.add_tcp(&format!("0.0.0.0:{}", config.gateway.port));
    let _ = my_server.add_service(redirect_proxy);
    info!("✅ HTTP 重定向服务监听于: 0.0.0.0:{}", config.gateway.port);

    if let Some((acme_config, acme_state, challenges)) = acme_runtime {
        let acme_service = background_service(
            "ACME Certificate Lifecycle",
            AcmeService::new(
                acme_config,
                acme_state,
                config.gateway.port,
                tls_store,
                challenges,
            ),
        );
        let _ = my_server.add_service(acme_service);
        info!("✅ Gateway 内建 ACME 证书生命周期服务已启用");
    }

    if tls_ready_at_boot {
        info!("🚀 SSO 去中心化网关监听服务与 HTTPS 已就绪");
    } else {
        info!("⏳ Gateway HTTP/ACME 引导服务已就绪，HTTPS 将在证书签发后自动上线");
    }
    my_server.run_forever();
}
