use anyhow::Context;
use clap::Parser;
use futures::FutureExt;
#[cfg(feature = "self-managed-tls")]
use pingora_core::listeners::tls::TlsSettings;
use pingora_core::prelude::*;
use pingora_core::services::background::background_service;
use pingora_load_balancing::discovery::{ServiceDiscovery, Static};
use pingora_load_balancing::health_check::TcpHealthCheck;
use pingora_load_balancing::selection::RoundRobin;
use pingora_load_balancing::{Backends, HealthCheckService, HealthRegistry, LoadBalancer};
use pingora_proxy::http_proxy_service;
use std::sync::Arc;
use std::time::Duration;
use tracing::info;

/// 主动健康检查探测周期（秒）——TCP 连通性探测，不可达节点摘出轮询
const HEALTH_CHECK_INTERVAL_SECS: u64 = 10;

#[cfg(feature = "self-managed-tls")]
use gateway::acme::{AcmeChallengeStore, AcmeService, AcmeState};
use gateway::auth::{JwtVerifier, TokenRefresher};
use gateway::config::{Config, Upstreams};
use gateway::gateway::{Gateway, GatewayDeps};
use gateway::jwks::JwksCache;
use gateway::path_matcher::PathMatcher;
#[cfg(feature = "self-managed-tls")]
use gateway::redirect::RedirectService;
use gateway::router::{RouteEntry, Router};
#[cfg(feature = "self-managed-tls")]
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
    info!("🚀 SSO 去中心化安全网关启动中 (Pingora 0.9.0 + ES256 JWKS 验签)...");
    #[cfg(feature = "self-managed-tls")]
    info!("  编译能力: 自托管 TLS + ACME");
    #[cfg(not(feature = "self-managed-tls"))]
    info!("  编译能力: 平台 TLS 终结");

    let upstream_routes = &config.upstreams;
    gateway::config::validate_routing_consistency(upstream_routes, &config.gateway.oauth)
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

    let jwks_cache = Arc::new(JwksCache::with_audience(
        config.gateway.oauth.client_id.clone(),
    ));
    let jwt_verifier = JwtVerifier::new(Arc::clone(&jwks_cache));
    let token_refresher = TokenRefresher::new(
        Arc::clone(&jwks_cache),
        Arc::clone(&portal_upstreams),
        config.gateway.upstream_scheme.clone(),
        config.gateway.gateway_shared_secret.clone(),
    );

    // 单一路由表：name/lb 一次装配（Router 内部按 prefix 长度降序排序）。
    // OAuth Client 凭据已收敛到 [gateway.oauth]（ADR-010 二期），不随路由携带。
    // 共享健康注册表：全部路由的 upstream 经单一 HealthCheckService 周期探活
    // （TCP 连通性，协议无关），不可达节点被摘出轮询；就绪状态经共享句柄
    // 实时传导到各 LoadBalancer 的选择器（BackendReadiness 持 Arc 活句柄），无需重建。
    let health_registry = Arc::new(HealthRegistry::new());
    health_registry.set_health_check(TcpHealthCheck::new());

    let mut entries: Vec<RouteEntry> = Vec::new();
    for uc in upstream_routes {
        let ups = Upstreams::from_config(&uc.addresses);
        if ups.is_empty() {
            anyhow::bail!("❌ upstream \"{}\" 未配置有效地址", uc.name);
        }
        let discovery: Box<dyn ServiceDiscovery + Send + Sync> = Static::try_from_iter(ups.iter())
            .map_err(|e| anyhow::anyhow!("配置 upstream \"{}\" 静态发现失败: {}", uc.name, e))?;
        let backends = Backends::new_with_health_registry(discovery, Arc::clone(&health_registry));
        let lb = Arc::new(LoadBalancer::<RoundRobin>::from_backends(backends));
        // 静态成员：立即构建选择器（与 try_from_iter 同语义，不会阻塞）
        lb.update()
            .now_or_never()
            .expect("static discovery should not block")
            .expect("static discovery should not error");
        entries.push(RouteEntry {
            prefix: uc.name.clone(),
            lb,
        });
    }
    let router = Router::new(entries);

    let all_public_paths: Vec<String> = upstream_routes
        .iter()
        .flat_map(|u| u.public_paths.iter().cloned())
        .collect();
    let path_matcher = PathMatcher::new(all_public_paths);

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
    info!("  默认 upstream: {}", router.fallback_prefix());

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
    let jwks_handle = my_server.add_service(jwks_refresh_svc);

    // 主动健康检查服务：周期探测全部 upstream 节点，就绪/摘除经共享注册表传导
    let mut health_check_service = HealthCheckService::new(health_registry);
    health_check_service.health_check_frequency =
        Some(Duration::from_secs(HEALTH_CHECK_INTERVAL_SECS));
    health_check_service.parallel_health_check = true;
    let _ = my_server.add_service(background_service("LB Health Check", health_check_service));

    let mut gateway_proxy = http_proxy_service(
        &my_server.configuration,
        Gateway::new(GatewayDeps {
            path_matcher,
            router,
            jwt_verifier,
            token_refresher,
            oidc_provider_upstream: portal_upstreams,
            gateway_shared_secret: config.gateway.gateway_shared_secret.clone(),
            upstream_scheme: config.gateway.upstream_scheme.clone(),
            upstream_server_name: config.gateway.upstream_server_name.clone(),
            upstream_host_header: config.gateway.upstream_host_header.clone(),
            trust_platform_client_ip: config.gateway.external_tls_termination,
            rate_limit: config.gateway.rate_limit.clone(),
            oauth: config.gateway.oauth.clone(),
            jwks_cache: Arc::clone(&jwks_cache),
        }),
    );

    if config.gateway.external_tls_termination {
        gateway_proxy.add_tcp(&format!("0.0.0.0:{}", config.gateway.port));
        let gateway_handle = my_server.add_service(gateway_proxy);
        gateway_handle.add_dependency(&redis_handle);
        gateway_handle.add_dependency(&jwks_handle);
        info!(
            "✅ 平台 TLS 终结代理服务监听于: 0.0.0.0:{}",
            config.gateway.port
        );
        info!("🚀 SSO 去中心化网关已就绪");
        my_server.run_forever();
    }

    #[cfg(not(feature = "self-managed-tls"))]
    anyhow::bail!("当前 Gateway 未编译 self-managed-tls，必须启用 external_tls_termination");

    #[cfg(feature = "self-managed-tls")]
    {
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
                TlsCertificateStore::load(
                    &config.gateway.ssl_cert_path,
                    &config.gateway.ssl_key_path,
                )
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
        gateway_handle.add_dependency(&jwks_handle);
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
}
