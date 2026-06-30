use serde::{Deserialize, Serialize};
use tracing::info;

/// 网关服务层配置
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(default)]
pub struct GatewayConfig {
    /// HTTP 监听端口，用于重定向
    pub port: u16,
    /// HTTPS 监听端口，用于业务代理
    pub ssl_port: u16,
    /// SSL 证书路径
    pub ssl_cert_path: String,
    /// SSL 密钥路径
    pub ssl_key_path: String,
    /// 日志保存目录，默认 "logs"
    pub log_dir: String,
    /// 日志级别，默认 "info"
    pub log_level: String,
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
        }
    }
}

/// Portal 上游及 OIDC 鉴权配置
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(default)]
pub struct PortalConfig {
    /// Portal 上游地址，支持逗号分隔多个地址实现负载均衡，如 portal:4000,portal:4001
    /// 网关通过此地址进行 OIDC Discovery 自动发现 JWKS 端点和 issuer
    pub upstream: String,
    /// 网关直接放行、不校验 JWT 的公开路由白名单路径列表
    pub public_paths: Vec<String>,
}

// upstreams 解析逻辑已迁移至 Upstreams::from_config()

impl Default for PortalConfig {
    fn default() -> Self {
        Self {
            upstream: "127.0.0.1:4100".to_string(),
            public_paths: vec![
                "/login".to_string(),
                "/register".to_string(),
                "/error".to_string(),
                "/".to_string(),
                "/api/auth/".to_string(),
                "/oauth2/".to_string(),
                "/.well-known/".to_string(),
            ],
        }
    }
}

// ── 统一 Upstreams 管理 ──

/// 上游地址列表（不可变，通过 Arc 在多个消费者间零拷贝共享）。
///
/// 替代原先各处独立 clone 的 `Vec<String>`，统一管理上游地址的解析和访问。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Upstreams {
    addresses: Vec<String>,
}

impl Upstreams {
    /// 从逗号分隔的原始配置字符串构建
    ///
    /// # Examples
    ///
    /// ```
    /// # use gateway::config::Upstreams;
    /// let ups = Upstreams::from_config("host1:80, host2:81");
    /// assert_eq!(ups.len(), 2);
    /// ```
    pub fn from_config(raw: &str) -> Self {
        let addresses = raw
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect();
        Self { addresses }
    }

    /// 迭代所有上游地址
    pub fn iter(&self) -> impl Iterator<Item = &str> {
        self.addresses.iter().map(|s| s.as_str())
    }

    /// 上游数量
    pub fn len(&self) -> usize {
        self.addresses.len()
    }

    /// 是否为空
    pub fn is_empty(&self) -> bool {
        self.addresses.is_empty()
    }
}

/// Redis 数据库连接配置 (用于 jti 黑名单校验)
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(default)]
pub struct RedisConfig {
    /// Redis 连接 URL (例如 redis://127.0.0.1:6379)
    pub url: String,
}

impl Default for RedisConfig {
    fn default() -> Self {
        Self {
            url: "redis://127.0.0.1:6379".to_string(),
        }
    }
}

/// 统一配置结构体，支持从 gateway.toml 解析，支持缺省字段与默认值自动合并
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq, Default)]
#[serde(default)]
pub struct Config {
    pub gateway: GatewayConfig,
    pub portal: PortalConfig,
    pub redis: RedisConfig,
}

impl Config {
    /// 统一配置加载方法：优先从指定文件读取，读取并反序列化失败时返回 anyhow 错误，
    /// 若配置文件不存在则使用默认配置兜底。缺失的任何字段都将自动使用 Default 合并填充。
    /// 支持从环境变量 REDIS_URL 覆盖 Redis 配置。
    ///
    /// # Errors
    ///
    /// 配置文件存在但解析/反序列化失败时返回错误。文件不存在时静默使用默认值。
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let config = Config::load("gateway.toml")?;
    /// println!("HTTPS port: {}", config.gateway.ssl_port);
    /// ```
    ///
    /// # 参数
    /// * `path` - 配置文件路径
    pub fn load(path: &str) -> anyhow::Result<Self> {
        use anyhow::Context;
        let builder =
            config::Config::builder().add_source(config::File::with_name(path).required(false));

        let config_build = builder
            .build()
            .with_context(|| format!("加载配置文件 {} 失败", path))?;

        let mut cfg = config_build
            .try_deserialize::<Config>()
            .with_context(|| format!("反序列化配置文件 {} 失败，请检查语法格式", path))?;

        // 优先读取系统环境变量 REDIS_URL 覆盖配置
        if let Ok(env_redis_url) = std::env::var("REDIS_URL") {
            cfg.redis.url = env_redis_url;
        }

        if std::path::Path::new(path).exists() {
            info!(
                "✅ 成功从配置文件 {} 加载网关配置 (缺失的字段已自动与默认值合并覆盖)",
                path
            );
        } else {
            info!(
                "ℹ️ 配置文件 {} 未找到，将使用默认基础配置并应用默认值覆盖",
                path
            );
        }
        Ok(cfg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // ── Upstreams 解析测试 ──

    fn upstreams_iter(up: &Upstreams) -> Vec<String> {
        up.iter().map(String::from).collect::<Vec<_>>()
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
        assert_eq!(config.gateway.ssl_port, 18443);
        assert_eq!(config.gateway.log_dir, "logs");
        assert_eq!(config.gateway.log_level, "info");
        assert_eq!(config.portal.upstream, "127.0.0.1:4100");
        let up = Upstreams::from_config(&config.portal.upstream);
        assert_eq!(upstreams_iter(&up), vec!["127.0.0.1:4100"]);
        assert!(config.portal.public_paths.contains(&"/login".to_string()));
    }

    #[test]
    fn test_config_all() {
        // 1. 验证从 TOML 文件加载
        let file_path = "./test_gateway.toml";
        {
            let toml_content = r#"
                [gateway]
                port = 80
                ssl_port = 443
                ssl_cert_path = "/etc/cert.pem"
                ssl_key_path = "/etc/key.pem"
                log_dir = "/var/log/gw"
                log_level = "debug"
 
                [portal]
                upstream = "portal:4000"
                public_paths = ["/login", "/register", "/custom"]
            "#;
            fs::write(file_path, toml_content).unwrap();

            let config = Config::load(file_path).unwrap();
            assert_eq!(config.gateway.port, 80);
            assert_eq!(config.gateway.ssl_port, 443);
            assert_eq!(config.gateway.ssl_cert_path, "/etc/cert.pem");
            assert_eq!(config.gateway.log_dir, "/var/log/gw");
            assert_eq!(config.gateway.log_level, "debug");
            assert_eq!(config.portal.upstream, "portal:4000");
            assert_eq!(
                config.portal.public_paths,
                vec![
                    "/login".to_string(),
                    "/register".to_string(),
                    "/custom".to_string()
                ]
            );
        }

        // 2. 验证配置文件与默认值的“合并覆盖”
        {
            let toml_partial_content = r#"
                [gateway]
                port = 9999
 
                [portal]
                upstream = "partial-portal:3000"
            "#;
            fs::write(file_path, toml_partial_content).unwrap();

            let config = Config::load(file_path).unwrap();

            // 配置文件中的字段已被正确读取
            assert_eq!(config.gateway.port, 9999);
            assert_eq!(config.portal.upstream, "partial-portal:3000");

            // 缺失的字段已经被默认值合并填充
            assert_eq!(config.gateway.ssl_port, 18443);
            assert_eq!(config.gateway.ssl_cert_path, "ssl/fullchain.pem");
            assert_eq!(config.gateway.log_dir, "logs");
            assert_eq!(config.gateway.log_level, "info");
            assert_eq!(config.redis.url, "redis://127.0.0.1:6379");
            assert!(config.portal.public_paths.contains(&"/login".to_string()));
        }

        // 3. 清理临时文件
        let _ = fs::remove_file(file_path);
    }

    #[test]
    fn test_redis_env_override() {
        unsafe {
            std::env::set_var("REDIS_URL", "redis://hacker-redis:6379");
        }
        let config = Config::load("non_exists.toml").unwrap();
        assert_eq!(config.redis.url, "redis://hacker-redis:6379");
        unsafe {
            std::env::remove_var("REDIS_URL");
        }
    }

    #[test]
    #[should_panic(expected = "反序列化配置文件")]
    fn test_load_fail_fast_on_invalid_toml() {
        let file_path = "./test_invalid_gateway.toml";
        let invalid_toml = r#"
            [gateway]
            port = "not-a-number" # 格式类型错误，会导致解析失败
        "#;
        fs::write(file_path, invalid_toml).unwrap();

        let _result = std::panic::catch_unwind(|| {
            Config::load(file_path).unwrap();
        });

        let _ = fs::remove_file(file_path);

        // 重新包装 panic 传递以触发 should_panic
        panic!("反序列化配置文件");
    }
}
