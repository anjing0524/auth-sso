use anyhow::bail;
use serde::Deserialize;
use std::collections::HashSet;
use tracing::info;

/// 网关服务层配置
#[derive(Debug, Deserialize, Clone)]
#[serde(default)]
pub struct GatewayConfig {
    pub port: u16,
    pub ssl_port: u16,
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
            ssl_cert_path: "ssl/fullchain.pem".to_string(),
            ssl_key_path: "ssl/privkey.pem".to_string(),
            log_dir: "logs".to_string(),
            log_level: "info".to_string(),
            gateway_shared_secret: None,
            upstream_scheme: "http".to_string(),
            jwks_refresh_interval_secs: 300,
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
    /// Gateway 需拦截的 OAuth callback 路径（相对路径，如 /api/auth/callback）
    #[serde(default = "default_callback_path")]
    pub callback_path: String,
}

fn default_callback_path() -> String {
    "/api/auth/callback".to_string()
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
            return Ok(Config::default());
        }

        let builder = config::Config::builder().add_source(config::File::from(path).required(true));
        let config_build = builder
            .build()
            .with_context(|| format!("加载配置文件 {} 失败", path.display()))?;
        let mut cfg: Config = config_build
            .try_deserialize()
            .with_context(|| format!("反序列化配置文件 {} 失败，请检查语法格式", path.display()))?;

        cfg.redis.url = resolve_redis_url(&cfg.redis.url, std::env::var("REDIS_URL").ok());
        cfg.gateway.gateway_shared_secret =
            resolve_optional_env(&cfg.gateway.gateway_shared_secret, "GATEWAY_SHARED_SECRET");
        cfg.gateway.upstream_scheme =
            resolve_env_str(&cfg.gateway.upstream_scheme, "UPSTREAM_SCHEME");
        // Redis 连接池参数 — 环境变量覆盖
        cfg.redis.pool_max_size = resolve_env_u32(cfg.redis.pool_max_size, "REDIS_POOL_MAX_SIZE");
        cfg.redis.pool_min_idle = resolve_env_u32(cfg.redis.pool_min_idle, "REDIS_POOL_MIN_IDLE");
        cfg.redis.pool_max_lifetime_sec = resolve_env_u64(
            cfg.redis.pool_max_lifetime_sec,
            "REDIS_POOL_MAX_LIFETIME_SEC",
        );
        cfg.redis.pool_idle_timeout_sec = resolve_env_u64(
            cfg.redis.pool_idle_timeout_sec,
            "REDIS_POOL_IDLE_TIMEOUT_SEC",
        );
        cfg.redis.pool_connection_timeout_sec = resolve_env_u64(
            cfg.redis.pool_connection_timeout_sec,
            "REDIS_POOL_CONNECTION_TIMEOUT_SEC",
        );
        // JWKS 刷新间隔 — 环境变量覆盖
        cfg.gateway.jwks_refresh_interval_secs = resolve_env_u64(
            cfg.gateway.jwks_refresh_interval_secs,
            "JWKS_REFRESH_INTERVAL_SECS",
        );

        if cfg.upstreams.is_empty() {
            anyhow::bail!(
                "❌ 未配置 [[upstreams]] 路由表。\n\
                 请在 gateway.toml 中添加 [[upstreams]] 条目，例如：\n\
                 [[upstreams]]\nname = \"/\"\naddresses = \"127.0.0.1:4100\"\n\
                 oidc_provider = true\n\
                 public_paths = [\"/login\", \"/api/auth/\", ...]"
            );
        }

        info!("✅ 成功从配置文件 {} 加载网关配置", path.display());
        Ok(cfg)
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            gateway: GatewayConfig::default(),
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
                    callback_path: "/api/auth/callback".to_string(),
                },
            }],
        }
    }
}

fn resolve_redis_url(config_value: &str, env_value: Option<String>) -> String {
    env_value.unwrap_or_else(|| config_value.to_string())
}

/// 优先从环境变量读取可选配置，回退到 TOML 文件值。
fn resolve_optional_env(config_value: &Option<String>, env_name: &str) -> Option<String> {
    std::env::var(env_name)
        .ok()
        .or_else(|| config_value.clone())
}

fn resolve_env_str(config_value: &str, env_name: &str) -> String {
    std::env::var(env_name).unwrap_or_else(|_| config_value.to_string())
}

fn resolve_env_u32(default_val: u32, env_name: &str) -> u32 {
    std::env::var(env_name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default_val)
}

fn resolve_env_u64(default_val: u64, env_name: &str) -> u64 {
    std::env::var(env_name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default_val)
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
                callback_path: "/api/auth/callback".to_string(),
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
}
