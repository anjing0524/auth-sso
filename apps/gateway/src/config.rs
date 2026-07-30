use anyhow::bail;
use serde::Deserialize;
use std::collections::HashSet;
use tracing::info;

const LETS_ENCRYPT_PRODUCTION_DIRECTORY: &str = "https://acme-v02.api.letsencrypt.org/directory";

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
    /// OAuth 2.1 Client 配置（必填）。
    /// Gateway 为该上游代为执行 PKCE 生成 + callback 拦截 + Token 交换（无感 SSO）。
    pub oauth: OAuthConfig,
}

/// 单个上游的 OAuth 2.1 客户端配置
#[derive(Debug, Deserialize, Clone)]
pub struct OAuthConfig {
    /// OAuth 2.1 client_id（在 Portal 中注册的客户端标识符）
    pub client_id: String,
    /// OAuth 2.1 client_secret。Gateway 代为拦截 callback + POST /token 换取 Token 并下发给浏览器。
    pub client_secret: String,
}

/// 启动期路由一致性校验。
pub fn validate_routing_consistency(routes: &[UpstreamConfig]) -> anyhow::Result<()> {
    let mut seen: HashSet<&str> = HashSet::new();
    for r in routes {
        if !seen.insert(r.name.as_str()) {
            bail!("upstream name \"{}\" 在路由表中重复出现", r.name);
        }
        if r.name.is_empty() {
            bail!("upstream name 不能为空字符串");
        }
        if r.oauth.client_id.is_empty() {
            bail!("upstream \"{}\" 的 oauth.client_id 不能为空", r.name);
        }
        if r.oauth.client_secret.is_empty() {
            bail!("upstream \"{}\" 的 oauth.client_secret 不能为空", r.name);
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
            info!("ℹ️ 配置文件 {} 未找到，使用默认配置", path.display());
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
        self.apply_portal_env_overrides()?;
        Ok(())
    }

    fn apply_portal_env_overrides(&mut self) -> anyhow::Result<()> {
        let Some(portal) = self.upstreams.iter_mut().find(|route| route.oidc_provider) else {
            return Ok(());
        };

        if let Ok(client_secret) = std::env::var("PORTAL_CLIENT_SECRET") {
            portal.oauth.client_secret = client_secret;
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
                oauth: OAuthConfig {
                    client_id: "portal".to_string(),
                    client_secret: String::new(),
                },
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
    if !cfg!(feature = "self-managed-tls") && !config.gateway.external_tls_termination {
        bail!("当前 Gateway 未编译 self-managed-tls，必须启用 EXTERNAL_TLS_TERMINATION");
    }
    if node_env == Some("production")
        && !config.gateway.external_tls_termination
        && config.acme.is_none()
    {
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
        if node_env == Some("production") && acme.ca_cert_path.is_some() {
            bail!("生产环境禁止配置 ACME_CA_CERT_PATH");
        }
        if acme.check_interval_secs == 0 {
            bail!("ACME_CHECK_INTERVAL_SECS 必须大于 0");
        }
    }
    if node_env == Some("production")
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

    #[cfg(feature = "self-managed-tls")]
    #[test]
    fn test_config_all() {
        let file_path = "./test_gateway.toml";
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

                [upstreams.oauth]
                client_id = "portal"
                client_secret = "portal-secret-123"
            "#;
            fs::write(file_path, toml).unwrap();
            let config = Config::load(file_path).unwrap();
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

                [upstreams.oauth]
                client_id = "portal"
                client_secret = "portal-secret-override"
            "#;
            fs::write(file_path, toml).unwrap();
            let config = Config::load(file_path).unwrap();
            assert_eq!(config.gateway.port, 9999);
            assert_eq!(config.upstreams[0].addresses, "partial-portal:3000");
            assert_eq!(config.gateway.ssl_port, 18443); // default
            assert!(config.upstreams[0].oidc_provider);
        }

        let _ = fs::remove_file(file_path);
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
        let fp = "./test_invalid_gateway.toml";
        fs::write(fp, r#"[gateway]\nport = "not-a-number""#).unwrap();
        assert!(Config::load(fp).is_err());
        let _ = fs::remove_file(fp);
    }

    #[test]
    fn load_rejects_old_portal_section() {
        let fp = "./test_old_portal.toml";
        let old = r#"
            [gateway]
            port = 8080
            [portal]
            upstream = "127.0.0.1:4100"
            public_paths = ["/login", "/register"]
        "#;
        fs::write(fp, old).unwrap();
        let err = Config::load(fp).unwrap_err().to_string();
        let _ = fs::remove_file(fp);
        assert!(
            err.contains("[[upstreams]]"),
            "错误应提示迁移到 [[upstreams]]，得到: {err}"
        );
    }

    #[test]
    fn upstream_route_config_parses_public_paths() {
        let fp = "./test_upstream_public.toml";
        let toml = r#"
            [gateway]
            external_tls_termination = true

            [[upstreams]]
            name = "/"
            addresses = "127.0.0.1:4100"
            oidc_provider = true

            [upstreams.oauth]
            client_id = "portal"
            client_secret = "portal-secret"

            [[upstreams]]
            name = "/demo/"
            addresses = "127.0.0.1:3100"
            public_paths = ["/demo/landing", "/demo/about"]

            [upstreams.oauth]
            client_id = "demo"
            client_secret = "demo-secret"
        "#;
        fs::write(fp, toml).unwrap();
        let config = Config::load(fp).unwrap();
        let _ = fs::remove_file(fp);

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
            oauth: OAuthConfig {
                client_id: "test".to_string(),
                client_secret: "test-secret".to_string(),
            },
        }
    }

    #[test]
    fn routing_check_ok() {
        let routes = vec![
            upstream("/", true),
            upstream("/demo/", false),
            upstream("/admin/", false),
        ];
        assert!(validate_routing_consistency(&routes).is_ok());
    }

    #[test]
    fn routing_check_rejects_duplicate_name() {
        let routes = vec![upstream("/a/", true), upstream("/a/", false)];
        let err = validate_routing_consistency(&routes).unwrap_err();
        assert!(err.to_string().contains("重复出现"));
    }

    #[test]
    fn routing_check_rejects_empty_name() {
        let routes = vec![upstream("/", true), upstream("", false)];
        let err = validate_routing_consistency(&routes).unwrap_err();
        assert!(err.to_string().contains("空字符串"));
    }

    #[test]
    fn routing_check_rejects_missing_oidc_provider() {
        let err = validate_routing_consistency(&[upstream("/", false)]).unwrap_err();
        assert!(err.to_string().contains("oidc_provider"));
    }

    #[test]
    fn routing_check_accepts_public_paths_within_own_prefix() {
        // name = "/" 天然涵盖全部路径；子路由白名单落在自身前缀内
        let mut portal = upstream("/", true);
        portal.public_paths = vec!["/login".into(), "/api/auth/".into()];
        let mut demo = upstream("/demo/", false);
        demo.public_paths = vec!["/demo/landing".into(), "/demo/about".into()];
        assert!(validate_routing_consistency(&[portal, demo]).is_ok());
    }

    #[test]
    fn routing_check_rejects_public_path_outside_own_prefix() {
        // /demo/ 声明 /login 白名单 → 越界（为 portal 的路径开免鉴权后门）
        let portal = upstream("/", true);
        let mut demo = upstream("/demo/", false);
        demo.public_paths = vec!["/login".into()];
        let err = validate_routing_consistency(&[portal, demo]).unwrap_err();
        assert!(err.to_string().contains("越界白名单"));
    }
}
