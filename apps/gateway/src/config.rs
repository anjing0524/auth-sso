use anyhow::bail;
use serde::Deserialize;
use std::collections::HashSet;
use tracing::info;

const LETS_ENCRYPT_PRODUCTION_DIRECTORY: &str = "https://acme-v02.api.letsencrypt.org/directory";

/// 认证端点进程内限流阈值（60s 滑动窗口）。
///
/// 默认值为生产建议基线（爆破防护）；E2E 通过 RATE_LIMIT_AUTH_MAX /
/// RATE_LIMIT_TOKEN_MAX 环境变量抬高档位，不再依赖源码内硬编码。
#[derive(Debug, Deserialize, Clone, PartialEq, Eq)]
pub struct RateLimitConfig {
    /// `/api/auth/*` 端点每分钟请求上限
    pub auth_max: isize,
    /// `/api/auth/oauth2/token` 端点每分钟请求上限
    pub token_max: isize,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            auth_max: 20,
            token_max: 30,
        }
    }
}

/// 部署环境（development/test/production）。生产安全校验以此为依据，
/// 不再依赖 NODE_ENV（Node.js 惯例不应泄入 Rust 配置）。
/// 可通过 GATEWAY_ENVIRONMENT 环境变量覆盖；未配置时回退读取 NODE_ENV。
#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Environment {
    #[default]
    Development,
    Test,
    Production,
}

impl std::str::FromStr for Environment {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "development" | "dev" => Ok(Self::Development),
            "test" => Ok(Self::Test),
            "production" | "prod" => Ok(Self::Production),
            other => Err(format!(
                "未知环境标识 {other:?}（支持 development/test/production）"
            )),
        }
    }
}

/// 网关服务层配置
#[derive(Debug, Deserialize, Clone)]
#[serde(default)]
pub struct GatewayConfig {
    pub port: u16,
    pub ssl_port: u16,
    /// TLS 由上游平台（如 Vercel）终结。启用后 Gateway 仅在 `port`
    /// 上提供明文 HTTP，且不启动 ACME、TLS 监听器或 HTTP 重定向服务。
    pub external_tls_termination: bool,
    pub ssl_cert_path: String,
    pub ssl_key_path: String,
    pub log_dir: String,
    pub log_level: String,
    /// 与 Portal 共享的 HMAC 密钥。Gateway 在向上游转发时用此密钥对
    /// (timestamp + user_id + jti) 计算 HMAC-SHA256 签名，注入
    /// X-Gateway-Signature / X-Gateway-Timestamp 请求头。
    /// Portal 端验证此签名以确认请求确实来自受信任的 Gateway。
    pub gateway_shared_secret: Option<String>,
    /// 内部上游请求协议（http 或 https），默认 "http"。
    /// 内网 mTLS 场景下可设为 "https"。
    #[serde(default = "default_upstream_scheme")]
    pub upstream_scheme: String,
    /// HTTPS 上游的 SNI 主机名。未配置时沿用浏览器请求 Host。
    pub upstream_server_name: Option<String>,
    /// 转发给上游的 Host。未配置时沿用浏览器请求 Host。
    pub upstream_host_header: Option<String>,
    /// JWKS 刷新成功后的标准间隔（秒，默认 300）。
    /// 可通过 JWKS_REFRESH_INTERVAL_SECS 环境变量覆盖。
    pub jwks_refresh_interval_secs: u64,
    /// 部署环境标识。生产安全校验以此为依据，
    /// 不再依赖 NODE_ENV（Node.js 惯例不应泄入 Rust 配置）。
    /// 可通过 GATEWAY_ENVIRONMENT 环境变量覆盖；未配置时回退读取 NODE_ENV。
    pub environment: Environment,
    /// 认证端点限流阈值。
    pub rate_limit: RateLimitConfig,
    /// 网关级统一 OAuth Client（ADR-010 二期）：所有被代理 upstream 共用，
    /// callback 拦截与 code→token 交换都使用这一组凭据。
    pub oauth: OAuthConfig,
}

fn default_upstream_scheme() -> String {
    "http".to_string()
}

impl Default for GatewayConfig {
    fn default() -> Self {
        Self {
            port: 18080,
            ssl_port: 18443,
            external_tls_termination: false,
            ssl_cert_path: "ssl/fullchain.pem".to_string(),
            ssl_key_path: "ssl/privkey.pem".to_string(),
            log_dir: "logs".to_string(),
            log_level: "info".to_string(),
            gateway_shared_secret: None,
            upstream_scheme: "http".to_string(),
            upstream_server_name: None,
            upstream_host_header: None,
            jwks_refresh_interval_secs: 300,
            environment: Environment::default(),
            rate_limit: RateLimitConfig::default(),
            oauth: OAuthConfig {
                client_id: "portal".to_string(),
                client_secret: String::new(),
            },
        }
    }
}

/// Gateway 内建 ACME 客户端配置。
#[derive(Debug, Deserialize, Clone)]
#[serde(default)]
pub struct AcmeConfig {
    /// HTTP-01 验证及证书签发使用的单个 DNS 域名。
    pub domain: String,
    /// ACME 账户联系邮箱。
    pub email: String,
    /// ACME directory URL；默认使用 Let's Encrypt 生产环境。
    pub directory_url: String,
    /// ACME 账户凭据、证书和私钥的持久化目录。
    pub state_dir: String,
    /// 仅供测试或内部 CA 使用的额外根证书路径；生产环境禁止配置。
    pub ca_cert_path: Option<String>,
    /// ARI/证书有效期复核间隔（秒）。
    pub check_interval_secs: u64,
}

impl Default for AcmeConfig {
    fn default() -> Self {
        Self {
            domain: String::new(),
            email: String::new(),
            directory_url: LETS_ENCRYPT_PRODUCTION_DIRECTORY.to_string(),
            state_dir: "acme".to_string(),
            ca_cert_path: None,
            check_interval_secs: 21_600,
        }
    }
}

/// 单个上游路由条目 — name 即 path prefix。
#[derive(Debug, Deserialize, Clone)]
pub struct UpstreamConfig {
    pub name: String,
    pub addresses: String,
    #[serde(default)]
    pub public_paths: Vec<String>,
    #[serde(default)]
    pub oidc_provider: bool,
}

/// 网关级统一 OAuth 2.1 客户端配置（ADR-010：Gateway 是唯一 OAuth Client）。
#[derive(Debug, Deserialize, Clone, Default, PartialEq, Eq)]
pub struct OAuthConfig {
    /// OAuth 2.1 client_id（在 Portal 中注册的客户端标识符）
    pub client_id: String,
    /// OAuth 2.1 client_secret。Gateway 代为拦截 callback + POST /token 换取 Token 并下发给浏览器。
    pub client_secret: String,
}

/// 启动期路由一致性校验。
pub fn validate_routing_consistency(
    routes: &[UpstreamConfig],
    oauth: &OAuthConfig,
) -> anyhow::Result<()> {
    // ADR-010 二期：凭据已收敛到 [gateway.oauth]，缺失即拒绝启动
    // （callback 换 token 无凭据可用）
    if oauth.client_id.is_empty() {
        bail!("gateway.oauth.client_id 不能为空（统一 OAuth Client 凭据）");
    }
    if oauth.client_secret.is_empty() {
        bail!("gateway.oauth.client_secret 不能为空（统一 OAuth Client 凭据）");
    }
    let mut seen: HashSet<&str> = HashSet::new();
    for r in routes {
        if !seen.insert(r.name.as_str()) {
            bail!("upstream name \"{}\" 在路由表中重复出现", r.name);
        }
        if r.name.is_empty() {
            bail!("upstream name 不能为空字符串");
        }
        // 白名单归属校验：public_path 必须落在自身路由前缀内，
        // 防止某个 upstream 的配置为其他 upstream 的路径开放免鉴权后门
        for p in &r.public_paths {
            if !p.starts_with(&r.name) {
                bail!(
                    "upstream \"{}\" 的 public_path \"{}\" 未以自身前缀开头，越界白名单被拒绝",
                    r.name,
                    p
                );
            }
        }
    }
    if !routes.iter().any(|r| r.oidc_provider) {
        bail!("至少需要一个 upstream 标记 oidc_provider = true");
    }
    Ok(())
}

/// 上游地址列表。
#[derive(Debug, Clone)]
pub struct Upstreams {
    addresses: Vec<String>,
}

impl Upstreams {
    pub fn from_config(raw: &str) -> Self {
        let addresses = raw
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect();
        Self { addresses }
    }

    pub fn iter(&self) -> impl Iterator<Item = &str> {
        self.addresses.iter().map(|s| s.as_str())
    }

    pub fn len(&self) -> usize {
        self.addresses.len()
    }

    pub fn is_empty(&self) -> bool {
        self.addresses.is_empty()
    }
}

/// Redis 配置
#[derive(Debug, Deserialize, Clone)]
#[serde(default)]
pub struct RedisConfig {
    pub url: String,
    /// 连接池最大连接数（默认 16），可通过 REDIS_POOL_MAX_SIZE 环境变量覆盖
    pub pool_max_size: u32,
    /// 连接池最小空闲连接数（默认 4），可通过 REDIS_POOL_MIN_IDLE 环境变量覆盖
    pub pool_min_idle: u32,
    /// 连接最大存活时间（秒，默认 1800），可通过 REDIS_POOL_MAX_LIFETIME_SEC 环境变量覆盖
    pub pool_max_lifetime_sec: u64,
    /// 空闲连接超时（秒，默认 300），可通过 REDIS_POOL_IDLE_TIMEOUT_SEC 环境变量覆盖
    pub pool_idle_timeout_sec: u64,
    /// 连接获取超时（秒，默认 3），可通过 REDIS_POOL_CONNECTION_TIMEOUT_SEC 环境变量覆盖
    pub pool_connection_timeout_sec: u64,
}

impl Default for RedisConfig {
    fn default() -> Self {
        Self {
            url: "redis://127.0.0.1:6379".to_string(),
            pool_max_size: 16,
            pool_min_idle: 4,
            pool_max_lifetime_sec: 1800,
            pool_idle_timeout_sec: 300,
            pool_connection_timeout_sec: 3,
        }
    }
}

/// 统一配置结构体。
#[derive(Debug, Deserialize, Clone)]
#[serde(default)]
pub struct Config {
    pub gateway: GatewayConfig,
    pub acme: Option<AcmeConfig>,
    pub redis: RedisConfig,
    #[serde(default)]
    pub upstreams: Vec<UpstreamConfig>,
}

impl Config {
    pub fn load(path: &str) -> anyhow::Result<Self> {
        use anyhow::Context;

        let path = std::path::Path::new(path);

        if !path.exists() {
            // 安全网关禁止静默回退默认配置（默认上游指向 127.0.0.1）：
            // `-c gateway.toml` 拼写错误的网关会"正常启动"并路由到 localhost。
            // 本地试验确需默认配置时，必须显式设置 GATEWAY_ALLOW_DEFAULT_CONFIG=1。
            if std::env::var("GATEWAY_ALLOW_DEFAULT_CONFIG")
                .ok()
                .as_deref()
                != Some("1")
            {
                bail!(
                    "配置文件 {} 不存在。安全网关禁止静默回退到默认配置；\
                     如确需本地试验，请显式设置 GATEWAY_ALLOW_DEFAULT_CONFIG=1",
                    path.display()
                );
            }
            info!(
                "ℹ️ 配置文件 {} 未找到（GATEWAY_ALLOW_DEFAULT_CONFIG=1），使用默认配置",
                path.display()
            );
            let mut cfg = Config::default();
            cfg.apply_env_overrides()?;
            validate_production_security(&cfg, std::env::var("NODE_ENV").ok().as_deref())?;
            return Ok(cfg);
        }

        let builder = config::Config::builder().add_source(config::File::from(path).required(true));
        let config_build = builder
            .build()
            .with_context(|| format!("加载配置文件 {} 失败", path.display()))?;
        let mut cfg: Config = config_build
            .try_deserialize()
            .with_context(|| format!("反序列化配置文件 {} 失败，请检查语法格式", path.display()))?;

        cfg.apply_env_overrides()?;

        if cfg.upstreams.is_empty() {
            anyhow::bail!(
                "❌ 未配置 [[upstreams]] 路由表。\n\
                 请在 gateway.toml 中添加 [[upstreams]] 条目，例如：\n\
                 [[upstreams]]\nname = \"/\"\naddresses = \"127.0.0.1:4100\"\n\
                 oidc_provider = true\n\
                 public_paths = [\"/login\", \"/api/auth/\", ...]"
            );
        }

        validate_production_security(&cfg, std::env::var("NODE_ENV").ok().as_deref())?;

        info!("✅ 成功从配置文件 {} 加载网关配置", path.display());
        Ok(cfg)
    }

    fn apply_env_overrides(&mut self) -> anyhow::Result<()> {
        self.gateway.external_tls_termination = resolve_env(
            self.gateway.external_tls_termination,
            "EXTERNAL_TLS_TERMINATION",
        )?;
        self.gateway.port = resolve_listener_port(
            self.gateway.port,
            self.gateway.external_tls_termination,
            std::env::var("GATEWAY_PORT").ok(),
            std::env::var("PORT").ok(),
        )?;
        self.gateway.ssl_port = resolve_env(self.gateway.ssl_port, "GATEWAY_SSL_PORT")?;
        self.gateway.ssl_cert_path = resolve_env_str(&self.gateway.ssl_cert_path, "SSL_CERT_PATH");
        self.gateway.ssl_key_path = resolve_env_str(&self.gateway.ssl_key_path, "SSL_KEY_PATH");
        self.apply_acme_env_overrides()?;
        self.redis.url = resolve_redis_url(&self.redis.url, std::env::var("REDIS_URL").ok());
        self.gateway.gateway_shared_secret =
            resolve_optional_env(&self.gateway.gateway_shared_secret, "GATEWAY_SHARED_SECRET");
        self.gateway.upstream_scheme =
            resolve_env_str(&self.gateway.upstream_scheme, "UPSTREAM_SCHEME");
        self.redis.pool_max_size = resolve_env(self.redis.pool_max_size, "REDIS_POOL_MAX_SIZE")?;
        self.redis.pool_min_idle = resolve_env(self.redis.pool_min_idle, "REDIS_POOL_MIN_IDLE")?;
        self.redis.pool_max_lifetime_sec = resolve_env(
            self.redis.pool_max_lifetime_sec,
            "REDIS_POOL_MAX_LIFETIME_SEC",
        )?;
        self.redis.pool_idle_timeout_sec = resolve_env(
            self.redis.pool_idle_timeout_sec,
            "REDIS_POOL_IDLE_TIMEOUT_SEC",
        )?;
        self.redis.pool_connection_timeout_sec = resolve_env(
            self.redis.pool_connection_timeout_sec,
            "REDIS_POOL_CONNECTION_TIMEOUT_SEC",
        )?;
        self.gateway.jwks_refresh_interval_secs = resolve_env(
            self.gateway.jwks_refresh_interval_secs,
            "JWKS_REFRESH_INTERVAL_SECS",
        )?;
        self.gateway.environment = resolve_env(self.gateway.environment, "GATEWAY_ENVIRONMENT")?;
        self.gateway.rate_limit.auth_max =
            resolve_env(self.gateway.rate_limit.auth_max, "RATE_LIMIT_AUTH_MAX")?;
        self.gateway.rate_limit.token_max =
            resolve_env(self.gateway.rate_limit.token_max, "RATE_LIMIT_TOKEN_MAX")?;
        self.apply_portal_env_overrides()?;
        Ok(())
    }

    fn apply_portal_env_overrides(&mut self) -> anyhow::Result<()> {
        let Some(portal) = self.upstreams.iter_mut().find(|route| route.oidc_provider) else {
            return Ok(());
        };

        if let Ok(client_secret) = std::env::var("PORTAL_CLIENT_SECRET") {
            self.gateway.oauth.client_secret = client_secret;
        }

        if let Ok(raw_url) = std::env::var("PORTAL_UPSTREAM_URL") {
            let endpoint = parse_upstream_url(&raw_url)?;
            portal.addresses = endpoint.address;
            self.gateway.upstream_scheme = endpoint.scheme;
            self.gateway.upstream_server_name = Some(endpoint.server_name);
            self.gateway.upstream_host_header = Some(endpoint.host_header);
        } else if let Ok(addresses) = std::env::var("PORTAL_UPSTREAM") {
            portal.addresses = addresses;
        }

        Ok(())
    }

    fn apply_acme_env_overrides(&mut self) -> anyhow::Result<()> {
        let domain = std::env::var("LETSENCRYPT_DOMAIN").ok();
        let email = std::env::var("LETSENCRYPT_EMAIL").ok();
        let directory_url = std::env::var("ACME_DIRECTORY_URL").ok();
        let state_dir = std::env::var("ACME_STATE_DIR").ok();
        let ca_cert_path = std::env::var("ACME_CA_CERT_PATH").ok();
        let check_interval = std::env::var("ACME_CHECK_INTERVAL_SECS").ok();

        if domain.is_none()
            && email.is_none()
            && directory_url.is_none()
            && state_dir.is_none()
            && ca_cert_path.is_none()
            && check_interval.is_none()
        {
            return Ok(());
        }

        let acme = self.acme.get_or_insert_with(AcmeConfig::default);
        if let Some(domain) = domain {
            acme.domain = domain;
        }
        if let Some(email) = email {
            acme.email = email;
        }
        if let Some(directory_url) = directory_url {
            acme.directory_url = directory_url;
        }
        if let Some(state_dir) = state_dir {
            acme.state_dir = state_dir;
        }
        if let Some(ca_cert_path) = ca_cert_path {
            acme.ca_cert_path = Some(ca_cert_path);
        }
        acme.check_interval_secs = resolve_env_value(
            acme.check_interval_secs,
            "ACME_CHECK_INTERVAL_SECS",
            check_interval,
        )?;
        Ok(())
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            gateway: GatewayConfig::default(),
            acme: None,
            redis: RedisConfig::default(),
            upstreams: vec![UpstreamConfig {
                name: "/".to_string(),
                addresses: "127.0.0.1:4100".to_string(),
                public_paths: vec![
                    "/login".into(),
                    "/register".into(),
                    "/error".into(),
                    "/api/auth/".into(),
                    "/oauth2/".into(),
                    "/.well-known/".into(),
                ],
                oidc_provider: true,
            }],
        }
    }
}

fn resolve_redis_url(config_value: &str, env_value: Option<String>) -> String {
    env_value.unwrap_or_else(|| config_value.to_string())
}

#[derive(Debug, PartialEq, Eq)]
struct ParsedUpstream {
    scheme: String,
    address: String,
    server_name: String,
    host_header: String,
}

fn parse_upstream_url(raw: &str) -> anyhow::Result<ParsedUpstream> {
    let parsed = reqwest::Url::parse(raw)
        .map_err(|error| anyhow::anyhow!("PORTAL_UPSTREAM_URL 不是有效 URL: {error}"))?;
    let scheme = parsed.scheme();
    if !matches!(scheme, "http" | "https") {
        bail!("PORTAL_UPSTREAM_URL 仅支持 http:// 或 https://");
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        bail!("PORTAL_UPSTREAM_URL 禁止携带用户凭据");
    }
    if parsed.path() != "/" || parsed.query().is_some() || parsed.fragment().is_some() {
        bail!("PORTAL_UPSTREAM_URL 不得包含路径、查询参数或片段");
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("PORTAL_UPSTREAM_URL 缺少主机名"))?;
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| anyhow::anyhow!("PORTAL_UPSTREAM_URL 缺少端口"))?;
    let address_host = if host.contains(':') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    let host_header = match parsed.port() {
        Some(explicit_port) => format!("{address_host}:{explicit_port}"),
        None => address_host.clone(),
    };

    Ok(ParsedUpstream {
        scheme: scheme.to_string(),
        address: format!("{address_host}:{port}"),
        server_name: host.to_string(),
        host_header,
    })
}

fn resolve_listener_port(
    default_value: u16,
    external_tls_termination: bool,
    gateway_port: Option<String>,
    platform_port: Option<String>,
) -> anyhow::Result<u16> {
    if gateway_port.is_some() {
        return resolve_env_value(default_value, "GATEWAY_PORT", gateway_port);
    }
    if external_tls_termination {
        return resolve_env_value(default_value, "PORT", platform_port);
    }
    Ok(default_value)
}

/// 优先从环境变量读取可选配置，回退到 TOML 文件值。
fn resolve_optional_env(config_value: &Option<String>, env_name: &str) -> Option<String> {
    std::env::var(env_name)
        .ok()
        .or_else(|| config_value.clone())
}

fn resolve_env<T>(default_value: T, env_name: &str) -> anyhow::Result<T>
where
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
{
    match std::env::var(env_name) {
        Ok(value) => resolve_env_value(default_value, env_name, Some(value)),
        Err(std::env::VarError::NotPresent) => Ok(default_value),
        Err(error) => Err(anyhow::anyhow!("环境变量 {env_name} 无法读取: {error}")),
    }
}

fn resolve_env_value<T>(
    default_value: T,
    env_name: &str,
    env_value: Option<String>,
) -> anyhow::Result<T>
where
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
{
    match env_value {
        Some(value) => value
            .parse()
            .map_err(|error| anyhow::anyhow!("环境变量 {env_name} 的值 {value:?} 无效: {error}")),
        None => Ok(default_value),
    }
}

fn resolve_env_str(config_value: &str, env_name: &str) -> String {
    std::env::var(env_name).unwrap_or_else(|_| config_value.to_string())
}

fn validate_production_security(config: &Config, node_env: Option<&str>) -> anyhow::Result<()> {
    // 生产判定：优先 gateway.environment，未配置时回退 NODE_ENV（兼容既有部署）
    let is_production = matches!(config.gateway.environment, Environment::Production)
        || node_env == Some("production");
    if !cfg!(feature = "self-managed-tls") && !config.gateway.external_tls_termination {
        bail!("当前 Gateway 未编译 self-managed-tls，必须启用 EXTERNAL_TLS_TERMINATION");
    }
    if is_production && !config.gateway.external_tls_termination && config.acme.is_none() {
        bail!("生产环境必须配置 LETSENCRYPT_DOMAIN 与 LETSENCRYPT_EMAIL");
    }
    if config.gateway.external_tls_termination && config.acme.is_some() {
        bail!("外部 TLS 终结模式禁止同时启用 ACME");
    }
    if let Some(acme) = &config.acme {
        if !is_valid_dns_name(&acme.domain) {
            bail!("LETSENCRYPT_DOMAIN 不是有效的 DNS 名称");
        }
        if !is_valid_email(&acme.email) {
            bail!("LETSENCRYPT_EMAIL 不是有效的联系邮箱");
        }
        if !acme.directory_url.starts_with("https://") {
            bail!("ACME_DIRECTORY_URL 必须使用 https://");
        }
        if acme.state_dir.is_empty() {
            bail!("ACME_STATE_DIR 不能为空");
        }
        if acme.ca_cert_path.as_deref().is_some_and(str::is_empty) {
            bail!("ACME_CA_CERT_PATH 不能为空");
        }
        if is_production && acme.ca_cert_path.is_some() {
            bail!("生产环境禁止配置 ACME_CA_CERT_PATH");
        }
        if acme.check_interval_secs == 0 {
            bail!("ACME_CHECK_INTERVAL_SECS 必须大于 0");
        }
    }
    if is_production
        && config
            .gateway
            .gateway_shared_secret
            .as_deref()
            .is_none_or(str::is_empty)
    {
        bail!("生产环境必须配置 GATEWAY_SHARED_SECRET");
    }
    Ok(())
}

fn is_valid_dns_name(domain: &str) -> bool {
    !domain.is_empty()
        && domain.len() <= 253
        && domain.contains('.')
        && domain.parse::<std::net::IpAddr>().is_err()
        && domain.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                && label
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_alphanumeric)
                && label
                    .as_bytes()
                    .last()
                    .is_some_and(u8::is_ascii_alphanumeric)
        })
}

fn is_valid_email(email: &str) -> bool {
    email
        .split_once('@')
        .is_some_and(|(local, domain)| !local.is_empty() && is_valid_dns_name(domain))
        && !email.bytes().any(|byte| byte.is_ascii_whitespace())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// 每份随包发布的配置都必须通过**完整的启动校验链**，而不只是反序列化。
    ///
    /// ## 为什么需要它
    ///
    /// `Config::load` 的链路是「反序列化 → apply_env_overrides →
    /// validate_production_security」；调用方随后还会跑
    /// `validate_routing_consistency`。既有测试只覆盖了第一环与最后一环的**单元**，
    /// 没有任何测试把**真实配置**跑完整条链——`gateway.vercel.toml` 的
    /// `[upstreams.oauth]` 段名错误正是因此逃逸到运行时（网关启动即退出）。
    ///
    /// ## 为什么不能一律按 production 校验
    ///
    /// 各配置的运行档位不同（见下表），一律按 production 会**误报**：
    /// 例如 `gateway.vercel.toml` 需要 `GATEWAY_SHARED_SECRET`（它由平台注入，
    /// 不在 TOML 里），而 `gateway.acme-*.toml` 的 ACME 参数全部来自环境变量
    /// （TOML 里没有 `[acme]` 段），故必须在对应档位下校验才有意义。
    ///
    /// | 配置 | consumer | 运行档 |
    /// |---|---|---|
    /// | `gateway.toml` / `gateway.docker.toml` | `apps/gateway/Dockerfile` | 自托管 TLS + ACME（env） |
    /// | `gateway.vercel.toml` | `Dockerfile.vercel` | `NODE_ENV=production` + 平台 TLS |
    /// | `gateway.e2e.toml` | `docker-compose.test.yml` | `NODE_ENV=test` |
    /// | `gateway.acme-e2e.toml` | `docker-compose.test.yml` | `NODE_ENV=test` |
    /// | `gateway.acme-staging.toml` | `docker-compose.acme-staging.yml` | `NODE_ENV=production` + ACME |
    #[test]
    fn test_all_shipped_configs_pass_startup_validation() {
        /// 各配置在其 consumer 下的运行档位。
        /// 该配置依赖哪种 TLS 终结方式。`self-managed-tls` 是**编译期特性**，
        /// 故这个维度决定了配置在哪种构建下才有资格通过启动校验。
        #[derive(Clone, Copy, PartialEq)]
        enum TlsMode {
            /// 需要 self-managed-tls 特性（自托管 TLS / ACME）
            SelfManaged,
            /// 平台 TLS 终结（`external_tls_termination = true`），两种构建皆可
            Platform,
        }

        struct Profile {
            node_env: Option<&'static str>,
            /// 该 consumer 是否通过环境变量提供 ACME 参数
            acme_from_env: bool,
            /// 该 consumer 是否通过环境注入 GATEWAY_SHARED_SECRET
            shared_secret_injected: bool,
            tls_mode: TlsMode,
        }

        /// 全部已发布 consumer 都会注入共享密钥；其余维度显式声明。
        fn profile(node_env: &'static str, acme_from_env: bool, tls_mode: TlsMode) -> Profile {
            Profile {
                node_env: Some(node_env),
                acme_from_env,
                shared_secret_injected: true,
                tls_mode,
            }
        }

        let configs: &[(&str, Profile)] = &[
            (
                "gateway.toml",
                profile("production", true, TlsMode::SelfManaged),
            ),
            (
                "gateway.docker.toml",
                profile("production", true, TlsMode::SelfManaged),
            ),
            // 平台 TLS：`Dockerfile.vercel` 用 `--no-default-features` 构建
            (
                "gateway.vercel.toml",
                profile("production", false, TlsMode::Platform),
            ),
            (
                "gateway.e2e.toml",
                profile("test", false, TlsMode::SelfManaged),
            ),
            (
                "gateway.acme-e2e.toml",
                profile("test", true, TlsMode::SelfManaged),
            ),
            (
                "gateway.acme-staging.toml",
                profile("production", true, TlsMode::SelfManaged),
            ),
        ];

        for (name, profile) in configs {
            let parsed: Config = config::Config::builder()
                .add_source(config::File::from(std::path::Path::new(name)).required(true))
                .build()
                .unwrap_or_else(|e| panic!("构建 {name} 配置失败: {e}"))
                .try_deserialize()
                .unwrap_or_else(|e| panic!("反序列化 {name} 失败: {e}"));

            let mut cfg = parsed;

            // 模拟 consumer 注入的环境变量（不经 std::env，避免测试间竞态）
            if profile.acme_from_env {
                cfg.acme = Some(AcmeConfig {
                    domain: "gateway.test".to_string(),
                    email: "ops@example.test".to_string(),
                    directory_url: "https://acme-v02.api.letsencrypt.org/directory".to_string(),
                    ..AcmeConfig::default()
                });
            }
            if profile.shared_secret_injected {
                cfg.gateway.gateway_shared_secret =
                    Some("injected-by-platform-shared-secret".to_string());
            }

            // 调用方（main.rs）施加的第一道校验。与 TLS 编译特性无关，故两种构建都必过。
            validate_routing_consistency(&cfg.upstreams, &cfg.gateway.oauth)
                .unwrap_or_else(|e| panic!("{name} 未通过路由一致性校验: {e}"));

            // Config::load 施加的第二道校验，其结果**取决于编译特性**：
            // - 平台 TLS 构建下，自托管配置本就应当被拒绝（错误地说"必须启用
            //   EXTERNAL_TLS_TERMINATION"），这正是防止把自托管配置部署到
            //   平台构建上的保护。
            match (cfg!(feature = "self-managed-tls"), profile.tls_mode) {
                (true, _) | (false, TlsMode::Platform) => {
                    validate_production_security(&cfg, profile.node_env).unwrap_or_else(|e| {
                        panic!(
                            "{name} 在 node_env={:?} 下未通过安全校验: {e}",
                            profile.node_env
                        )
                    });
                }
                (false, TlsMode::SelfManaged) => {
                    let err =
                        validate_production_security(&cfg, profile.node_env).expect_err(concat!(
                            "{name} 依赖 self-managed-tls，在平台 TLS 构建下",
                            " 本应被拒绝却能通过——构建裁剪的保护失效了"
                        ));
                    assert!(
                        err.to_string().contains("self-managed-tls"),
                        "{name} 在平台 TLS 构建下被拒绝，但原因不是构建特性: {err}"
                    );
                }
            }
        }
    }

    /// 所有随包发布的 gateway 配置都必须能被解析出 **非空** OAuth 凭据。
    ///
    /// ## 为什么需要它
    ///
    /// `OAuthConfig` 是 `GatewayConfig` 的字段（`[gateway.oauth]`），而
    /// `UpstreamConfig` **没有** `oauth` 字段。历史上把凭据写在
    /// `[upstreams.oauth]` 时，`config` crate 会**静默忽略**该未知字段，
    /// 于是 `gateway.oauth` 保持 `Default`（空串），直到启动期
    /// `validate_routing_consistency` 才 bail：
    ///
    /// ```text
    /// gateway.oauth.client_secret 不能为空（统一 OAuth Client 凭据）
    /// ```
    ///
    /// 后果是网关**启动即失败**，HTTP 引导监听器根本不存在——CI 的
    /// `Gateway ACME Lifecycle` 因此报"未返回 301"，而真实原因藏在容器日志里，
    /// 诊断成本远高于在此处直接断言。
    ///
    /// 本测试遍历**已发布的全部配置**，使这类"静默忽略"在单测阶段暴露，
    /// 而不是留给运行时。
    #[test]
    fn test_all_shipped_configs_have_non_empty_oauth_credentials() {
        // 相对 crate 根（apps/gateway）——不依赖 cwd 之外的路径。
        const CONFIGS: &[&str] = &[
            "gateway.toml",
            "gateway.e2e.toml",
            "gateway.docker.toml",
            "gateway.vercel.toml",
            "gateway.acme-e2e.toml",
            "gateway.acme-staging.toml",
        ];

        for name in CONFIGS {
            let path = std::path::Path::new(name);
            assert!(path.exists(), "{name} 不存在（测试清单与实际文件已脱节）");

            let raw = fs::read_to_string(path).unwrap_or_else(|e| panic!("读取 {name} 失败: {e}"));
            let parsed: Config = config::Config::builder()
                .add_source(config::File::from(path).required(true))
                .build()
                .unwrap_or_else(|e| panic!("构建 {name} 配置失败: {e}"))
                .try_deserialize()
                .unwrap_or_else(|e| panic!("反序列化 {name} 失败: {e}"));

            assert!(
                !parsed.gateway.oauth.client_id.is_empty(),
                "{name} 未解析出 gateway.oauth.client_id——凭据可能被写在了 \
                 [upstreams.oauth]（UpstreamConfig 无该字段，会被静默忽略）"
            );
            assert!(
                !parsed.gateway.oauth.client_secret.is_empty(),
                "{name} 未解析出 gateway.oauth.client_secret——凭据可能被写在了 \
                 [upstreams.oauth]（UpstreamConfig 无该字段，会被静默忽略）"
            );

            // 同时确认该配置能通过启动期校验（本测试的存在理由就是它曾在此 bail）
            validate_routing_consistency(&parsed.upstreams, &parsed.gateway.oauth)
                .unwrap_or_else(|e| panic!("{name} 未通过路由一致性校验: {e}"));

            // 旧段名不应再出现在任何已发布配置中（防止回退）
            assert!(
                !raw.contains("[upstreams.oauth]"),
                "{name} 仍含已废弃的 [upstreams.oauth] 段——该段会被静默忽略"
            );
        }
    }

    fn upstreams_iter(up: &Upstreams) -> Vec<String> {
        up.iter().map(String::from).collect()
    }

    #[test]
    fn test_upstreams_single() {
        let up = Upstreams::from_config("127.0.0.1:4100");
        assert_eq!(upstreams_iter(&up), vec!["127.0.0.1:4100"]);
    }

    #[test]
    fn test_upstreams_multiple() {
        let up = Upstreams::from_config("portal:4000, portal:4001, portal:4002");
        assert_eq!(
            upstreams_iter(&up),
            vec!["portal:4000", "portal:4001", "portal:4002"]
        );
    }

    #[test]
    fn test_upstreams_trims_whitespace() {
        let up = Upstreams::from_config("  host1:80 , host2:81  ,host3:82");
        assert_eq!(
            upstreams_iter(&up),
            vec!["host1:80", "host2:81", "host3:82"]
        );
    }

    #[test]
    fn test_upstreams_filters_empty() {
        let up = Upstreams::from_config("host1:80,,host2:81");
        assert_eq!(upstreams_iter(&up), vec!["host1:80", "host2:81"]);
    }

    #[test]
    fn test_load_default_config() {
        let config = Config::default();
        assert_eq!(config.gateway.port, 18080);
        assert!(!config.gateway.external_tls_termination);
        assert_eq!(config.upstreams.len(), 1);
        assert_eq!(config.upstreams[0].name, "/");
        assert!(config.upstreams[0].oidc_provider);
        assert!(
            config.upstreams[0]
                .public_paths
                .contains(&"/login".to_string())
        );
    }

    #[test]
    fn test_validate_rejects_missing_gateway_oauth_credentials() {
        // ADR-010 二期：凭据收敛到 [gateway.oauth]，缺失直接拒绝启动
        let routes = vec![upstream("/", true)];
        let err = validate_routing_consistency(&routes, &OAuthConfig::default()).unwrap_err();
        assert!(err.to_string().contains("gateway.oauth.client_id 不能为空"));
    }

    #[test]
    fn test_validate_accepts_with_gateway_oauth() {
        let routes = vec![upstream("/", true), upstream("/demo/", false)];
        let oauth = OAuthConfig {
            client_id: "portal".to_string(),
            client_secret: "shared-secret".to_string(),
        };
        assert!(validate_routing_consistency(&routes, &oauth).is_ok());
    }

    #[test]
    fn test_load_missing_config_fails_fast() {
        // 默认配置静默回退已被禁止（audit 2026-09-28）；仅当显式设置
        // GATEWAY_ALLOW_DEFAULT_CONFIG=1 时才允许本地试验场景
        if std::env::var("GATEWAY_ALLOW_DEFAULT_CONFIG").is_ok() {
            assert!(Config::load("./definitely-missing-gateway.toml").is_ok());
        } else {
            let err = Config::load("./definitely-missing-gateway.toml").unwrap_err();
            assert!(err.to_string().contains("GATEWAY_ALLOW_DEFAULT_CONFIG"));
        }
    }

    #[cfg(feature = "self-managed-tls")]
    #[test]
    fn test_config_all() {
        let file_path = std::env::temp_dir().join("auth-sso-gw-test_gateway.toml");
        {
            let toml = r#"
                [gateway]
                port = 80
                ssl_port = 443
                ssl_cert_path = "/etc/cert.pem"
                ssl_key_path = "/etc/key.pem"
                log_dir = "/var/log/gw"
                log_level = "debug"

                [acme]
                domain = "sso.example.com"
                email = "ops@example.com"
                state_dir = "/var/lib/gateway/acme"
                check_interval_secs = 3600

                [[upstreams]]
                name = "/"
                addresses = "portal:4000"
                oidc_provider = true
                public_paths = ["/login", "/register", "/custom"]

                [gateway.oauth]
                client_id = "portal"
                client_secret = "portal-secret-123"
            "#;
            fs::write(&file_path, toml).unwrap();
            let config = Config::load(file_path.to_str().unwrap()).unwrap();
            assert_eq!(config.gateway.port, 80);
            assert_eq!(
                config.acme.as_ref().map(|acme| acme.domain.as_str()),
                Some("sso.example.com")
            );
            assert_eq!(config.upstreams.len(), 1);
            assert_eq!(config.upstreams[0].name, "/");
            assert!(config.upstreams[0].oidc_provider);
            assert_eq!(
                config.upstreams[0].public_paths,
                vec!["/login", "/register", "/custom"]
            );
        }

        // 合并覆盖
        {
            let toml = r#"
                [gateway]
                port = 9999
                [[upstreams]]
                name = "/"
                addresses = "partial-portal:3000"
                oidc_provider = true

                [gateway.oauth]
                client_id = "portal"
                client_secret = "portal-secret-override"
            "#;
            fs::write(&file_path, toml).unwrap();
            let config = Config::load(file_path.to_str().unwrap()).unwrap();
            assert_eq!(config.gateway.port, 9999);
            assert_eq!(config.upstreams[0].addresses, "partial-portal:3000");
            assert_eq!(config.gateway.ssl_port, 18443); // default
            assert!(config.upstreams[0].oidc_provider);
        }

        let _ = fs::remove_file(&file_path);
    }

    #[test]
    fn resolve_redis_url_prefers_env() {
        assert_eq!(
            resolve_redis_url("redis://cfg:6379", Some("redis://env:6380".to_string())),
            "redis://env:6380"
        );
    }

    #[test]
    fn resolve_redis_url_falls_back() {
        assert_eq!(
            resolve_redis_url("redis://cfg:6379", None),
            "redis://cfg:6379"
        );
    }

    #[test]
    fn parses_https_upstream_url_for_load_balancer_and_http_host() {
        assert_eq!(
            parse_upstream_url("https://portal.internal.example").unwrap(),
            ParsedUpstream {
                scheme: "https".to_string(),
                address: "portal.internal.example:443".to_string(),
                server_name: "portal.internal.example".to_string(),
                host_header: "portal.internal.example".to_string(),
            }
        );
    }

    #[test]
    fn preserves_explicit_upstream_port() {
        assert_eq!(
            parse_upstream_url("http://portal.internal.example:4100").unwrap(),
            ParsedUpstream {
                scheme: "http".to_string(),
                address: "portal.internal.example:4100".to_string(),
                server_name: "portal.internal.example".to_string(),
                host_header: "portal.internal.example:4100".to_string(),
            }
        );
    }

    #[test]
    fn rejects_upstream_url_with_path_or_credentials() {
        assert!(parse_upstream_url("https://portal.internal.example/base").is_err());
        assert!(parse_upstream_url("https://user:secret@portal.internal.example").is_err());
        assert!(parse_upstream_url("ftp://portal.internal.example").is_err());
    }

    #[test]
    fn external_tls_mode_uses_platform_port_as_fallback() {
        assert_eq!(
            resolve_listener_port(18080, true, None, Some("8080".to_string())).unwrap(),
            8080
        );
        assert_eq!(
            resolve_listener_port(
                18080,
                true,
                Some("9090".to_string()),
                Some("8080".to_string())
            )
            .unwrap(),
            9090
        );
        assert_eq!(
            resolve_listener_port(18080, false, None, Some("8080".to_string())).unwrap(),
            18080
        );
    }

    #[test]
    fn numeric_env_override_rejects_invalid_values() {
        assert_eq!(
            resolve_env_value(300_u64, "ACME_CHECK_INTERVAL_SECS", None).unwrap(),
            300
        );
        assert_eq!(
            resolve_env_value(300_u64, "ACME_CHECK_INTERVAL_SECS", Some("60".to_string())).unwrap(),
            60
        );

        let error = resolve_env_value(
            300_u64,
            "ACME_CHECK_INTERVAL_SECS",
            Some("not-a-number".to_string()),
        )
        .unwrap_err();
        assert!(error.to_string().contains("ACME_CHECK_INTERVAL_SECS"));
        assert!(error.to_string().contains("not-a-number"));
    }

    #[cfg(feature = "self-managed-tls")]
    #[test]
    fn production_requires_gateway_shared_secret() {
        let config = Config::default();
        assert!(validate_production_security(&config, Some("production")).is_err());

        let mut configured = config;
        configured.gateway.gateway_shared_secret = Some("test-secret".to_string());
        configured.acme = Some(AcmeConfig {
            domain: "sso.example.com".to_string(),
            email: "ops@example.com".to_string(),
            ..AcmeConfig::default()
        });
        assert!(validate_production_security(&configured, Some("production")).is_ok());
        assert!(validate_production_security(&Config::default(), Some("development")).is_ok());
    }

    #[test]
    fn production_external_tls_mode_does_not_require_acme() {
        let mut config = Config::default();
        config.gateway.external_tls_termination = true;
        config.gateway.gateway_shared_secret = Some("test-secret".to_string());

        assert!(validate_production_security(&config, Some("production")).is_ok());

        config.acme = Some(AcmeConfig {
            domain: "sso.example.com".to_string(),
            email: "ops@example.com".to_string(),
            ..AcmeConfig::default()
        });
        assert!(validate_production_security(&config, Some("production")).is_err());
    }

    #[cfg(not(feature = "self-managed-tls"))]
    #[test]
    fn platform_tls_build_rejects_self_managed_listener_mode() {
        let mut config = Config::default();
        config.gateway.gateway_shared_secret = Some("test-secret".to_string());

        let error = validate_production_security(&config, Some("development")).unwrap_err();
        assert!(error.to_string().contains("self-managed-tls"));

        config.gateway.external_tls_termination = true;
        assert!(validate_production_security(&config, Some("production")).is_ok());
    }

    #[cfg(feature = "self-managed-tls")]
    #[test]
    fn config_rejects_invalid_acme_settings() {
        let mut config = Config {
            acme: Some(AcmeConfig {
                domain: "../example.com".to_string(),
                email: "invalid".to_string(),
                directory_url: "http://acme.example.com/directory".to_string(),
                state_dir: String::new(),
                ca_cert_path: None,
                check_interval_secs: 0,
            }),
            ..Config::default()
        };
        assert!(validate_production_security(&config, Some("development")).is_err());
        assert!(!is_valid_dns_name("localhost"));
        assert!(!is_valid_dns_name("127.0.0.1"));

        let acme = AcmeConfig {
            domain: "sso.example.com".to_string(),
            email: "ops@example.com".to_string(),
            ..AcmeConfig::default()
        };
        config.acme = Some(acme);
        assert!(validate_production_security(&config, Some("development")).is_ok());

        config.acme.as_mut().unwrap().ca_cert_path = Some("/test/pebble.minica.pem".to_string());
        assert!(validate_production_security(&config, Some("test")).is_ok());
        assert!(validate_production_security(&config, Some("production")).is_err());
    }

    #[test]
    fn load_rejects_invalid_toml() {
        // 真实换行（此前 raw string 使 \n 成为字面量，测的是畸形 key 而非类型错误）
        let fp = std::env::temp_dir().join("auth-sso-gw-test-invalid-gateway.toml");
        fs::write(&fp, "[gateway]\nport = \"not-a-number\"").unwrap();
        assert!(Config::load(fp.to_str().unwrap()).is_err());
        let _ = fs::remove_file(&fp);
    }

    #[test]
    fn load_rejects_old_portal_section() {
        let fp = std::env::temp_dir().join("auth-sso-gw-test_old_portal.toml");
        let old = r#"
            [gateway]
            port = 8080
            [portal]
            upstream = "127.0.0.1:4100"
            public_paths = ["/login", "/register"]
        "#;
        fs::write(&fp, old).unwrap();
        let err = Config::load(fp.to_str().unwrap()).unwrap_err().to_string();
        let _ = fs::remove_file(&fp);
        assert!(
            err.contains("[[upstreams]]"),
            "错误应提示迁移到 [[upstreams]]，得到: {err}"
        );
    }

    #[test]
    fn upstream_route_config_parses_public_paths_and_ignores_unknown_tables() {
        let fp = std::env::temp_dir().join("auth-sso-gw-test_upstream_public.toml");
        let toml = r#"
            [gateway]
            external_tls_termination = true

            [[upstreams]]
            name = "/"
            addresses = "127.0.0.1:4100"
            oidc_provider = true

            [[upstreams]]
            name = "/demo/"
            addresses = "127.0.0.1:3100"
            public_paths = ["/demo/landing", "/demo/about"]
        "#;
        fs::write(&fp, toml).unwrap();
        let config = Config::load(fp.to_str().unwrap()).unwrap();
        let _ = fs::remove_file(&fp);

        let portal = config.upstreams.iter().find(|u| u.name == "/").unwrap();
        assert!(portal.oidc_provider);
        assert!(portal.public_paths.is_empty());

        let demo = config
            .upstreams
            .iter()
            .find(|u| u.name == "/demo/")
            .unwrap();
        assert!(!demo.oidc_provider);
        assert_eq!(demo.public_paths, vec!["/demo/landing", "/demo/about"]);
    }

    fn upstream(name: &str, oidc_provider: bool) -> UpstreamConfig {
        UpstreamConfig {
            name: name.to_string(),
            addresses: "127.0.0.1:4100".to_string(),
            public_paths: Vec::new(),
            oidc_provider,
        }
    }

    fn gw_oauth() -> OAuthConfig {
        OAuthConfig {
            client_id: "portal".to_string(),
            client_secret: "test-secret".to_string(),
        }
    }

    #[test]
    fn routing_check_ok() {
        let routes = vec![
            upstream("/", true),
            upstream("/demo/", false),
            upstream("/admin/", false),
        ];
        assert!(validate_routing_consistency(&routes, &gw_oauth()).is_ok());
    }

    #[test]
    fn routing_check_rejects_duplicate_name() {
        let routes = vec![upstream("/a/", true), upstream("/a/", false)];
        let err = validate_routing_consistency(&routes, &gw_oauth()).unwrap_err();
        assert!(err.to_string().contains("重复出现"));
    }

    #[test]
    fn routing_check_rejects_empty_name() {
        let routes = vec![upstream("/", true), upstream("", false)];
        let err = validate_routing_consistency(&routes, &gw_oauth()).unwrap_err();
        assert!(err.to_string().contains("空字符串"));
    }

    #[test]
    fn routing_check_rejects_missing_oidc_provider() {
        let err = validate_routing_consistency(&[upstream("/", false)], &gw_oauth()).unwrap_err();
        assert!(err.to_string().contains("oidc_provider"));
    }

    #[test]
    fn routing_check_accepts_public_paths_within_own_prefix() {
        // name = "/" 天然涵盖全部路径；子路由白名单落在自身前缀内
        let mut portal = upstream("/", true);
        portal.public_paths = vec!["/login".into(), "/api/auth/".into()];
        let mut demo = upstream("/demo/", false);
        demo.public_paths = vec!["/demo/landing".into(), "/demo/about".into()];
        assert!(validate_routing_consistency(&[portal, demo], &gw_oauth()).is_ok());
    }

    #[test]
    fn routing_check_rejects_public_path_outside_own_prefix() {
        // /demo/ 声明 /login 白名单 → 越界（为 portal 的路径开免鉴权后门）
        let portal = upstream("/", true);
        let mut demo = upstream("/demo/", false);
        demo.public_paths = vec!["/login".into()];
        let err = validate_routing_consistency(&[portal, demo], &gw_oauth()).unwrap_err();
        assert!(err.to_string().contains("越界白名单"));
    }
}
