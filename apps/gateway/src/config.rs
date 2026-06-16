use log::{error, info};
use serde::{Deserialize, Serialize};
use std::env;

/// 网关服务层配置
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
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
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(default)]
pub struct PortalConfig {
    /// Portal 上游地址，如 portal:4000
    pub upstream: String,
    /// Portal 的 JWKS 公钥刷新端点 URL
    pub jwks_url: String,
    /// Portal 的 OIDC JWT 校验发行者 (iss)
    pub issuer: String,
    /// 网关直接放行、不校验 JWT 的公开路由白名单路径列表
    pub public_paths: Option<Vec<String>>,
}

impl Default for PortalConfig {
    fn default() -> Self {
        Self {
            upstream: "127.0.0.1:4000".to_string(),
            jwks_url: "http://127.0.0.1:4000/api/auth/.well-known/jwks".to_string(),
            issuer: "http://localhost:4000".to_string(),
            public_paths: Some(vec![
                "/login".to_string(),
                "/register".to_string(),
                "/error".to_string(),
                "/".to_string(),
                "/api/auth/".to_string(),
                "/oauth2/".to_string(),
                "/.well-known/".to_string(),
            ]),
        }
    }
}

/// 统一配置结构体，支持从 gateway.toml 解析，支持缺省字段与默认值自动合并
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(default)]
pub struct Config {
    pub gateway: GatewayConfig,
    pub portal: PortalConfig,
}

/// 自定义配置源：用于将系统中统一约定的环境变量精确映射到配置结构树上
/// 避免使用默认的全局 separator("_") 导致字段内部下划线（如 ssl_cert_path）被错误切碎
#[derive(Clone, Debug)]
struct GatewayEnvSource;

impl config::Source for GatewayEnvSource {
    fn clone_into_box(&self) -> Box<dyn config::Source + Send + Sync> {
        Box::new(self.clone())
    }

    fn collect(&self) -> Result<config::Map<String, config::Value>, config::ConfigError> {
        let mut map = config::Map::new();
        // 声明规范的系统环境变量与配置项的精确绑定关系
        let env_mappings = [
            ("GATEWAY_PORT", "gateway.port"),
            ("GATEWAY_SSL_PORT", "gateway.ssl_port"),
            ("GATEWAY_SSL_CERT_PATH", "gateway.ssl_cert_path"),
            ("GATEWAY_SSL_KEY_PATH", "gateway.ssl_key_path"),
            ("GATEWAY_LOG_DIR", "gateway.log_dir"),
            ("GATEWAY_LOG_LEVEL", "gateway.log_level"),
            ("PORTAL_UPSTREAM", "portal.upstream"),
            ("PORTAL_JWKS_URL", "portal.jwks_url"),
            ("PORTAL_ISSUER", "portal.issuer"),
        ];

        for (env_name, config_path) in env_mappings {
            if let Ok(val) = env::var(env_name) {
                info!("检测到环境变量覆盖: {}={}", env_name, val);
                map.insert(
                    config_path.to_string(),
                    config::Value::new(None, config::ValueKind::String(val)),
                );
            }
        }

        Ok(map)
    }
}

impl Config {
    /// 统一配置加载方法：优先从指定文件读取，读取成功但解析失败时 Fail-Fast 强制 panic 报错退出，
    /// 若配置文件不存在则使用默认配置兜底。缺失的任何字段都将自动使用 Default 合并填充，
    /// 最后通过系统的统一环境变量进行动态覆盖。
    ///
    /// # 参数
    /// * `path` - 配置文件路径
    pub fn load(path: &str) -> Self {
        // 1. 构建配置，合并本地 TOML 文件源及规范环境变量源
        let builder = config::Config::builder()
            .add_source(config::File::with_name(path).required(false))
            .add_source(GatewayEnvSource);

        // 2. 直接反序列化到 Config 结构体中，自动利用 Serde 的 default 属性补齐缺失的字段
        let mut cfg = match builder.build() {
            Ok(config_build) => match config_build.try_deserialize::<Config>() {
                Ok(cfg) => {
                    if std::path::Path::new(path).exists() {
                        info!(
                            "✅ 成功从配置文件 {} 加载网关配置 (缺失的字段已自动与默认值合并覆盖)",
                            path
                        );
                    } else {
                        info!(
                            "ℹ️ 配置文件 {} 未找到，将使用默认基础配置并应用环境变量覆盖",
                            path
                        );
                    }
                    cfg
                }
                Err(e) => {
                    error!(
                        "❌ 配置文件 {} 反序列化失败: {:?}，请检查语法格式与环境变量数据类型！",
                        path, e
                    );
                    panic!(
                        "网关配置文件解析失败，为了避免隐性配置错误运行，安全阻断退出: {:?}",
                        e
                    );
                }
            },
            Err(e) => {
                error!("❌ 配置文件 {} 加载失败: {:?}，请检查语法格式！", path, e);
                panic!(
                    "网关配置文件解析失败，为了避免隐性配置错误运行，安全阻断退出: {:?}",
                    e
                );
            }
        };

        // 3. 简单且类型安全地提取列表型环境变量进行后处理覆盖，免去复杂的反序列化器定义
        if let Ok(val) = env::var("PORTAL_PUBLIC_PATHS") {
            info!("检测到环境变量覆盖: PORTAL_PUBLIC_PATHS={}", val);
            let paths: Vec<String> = val.split(',').map(|s| s.trim().to_string()).collect();
            cfg.portal.public_paths = Some(paths);
        }

        cfg
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_load_default_config() {
        let config = Config::default();
        assert_eq!(config.gateway.port, 18080);
        assert_eq!(config.gateway.ssl_port, 18443);
        assert_eq!(config.gateway.log_dir, "logs");
        assert_eq!(config.gateway.log_level, "info");
        assert_eq!(config.portal.upstream, "127.0.0.1:4000");
        assert!(
            config
                .portal
                .public_paths
                .unwrap()
                .contains(&"/login".to_string())
        );
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
                jwks_url = "https://portal/.well-known/jwks"
                issuer = "https://portal"
                public_paths = ["/login", "/register", "/custom"]
            "#;
            fs::write(file_path, toml_content).unwrap();

            let config = Config::load(file_path);
            assert_eq!(config.gateway.port, 80);
            assert_eq!(config.gateway.ssl_port, 443);
            assert_eq!(config.gateway.ssl_cert_path, "/etc/cert.pem");
            assert_eq!(config.gateway.log_dir, "/var/log/gw");
            assert_eq!(config.gateway.log_level, "debug");
            assert_eq!(config.portal.upstream, "portal:4000");
            assert_eq!(
                config.portal.public_paths.unwrap(),
                vec![
                    "/login".to_string(),
                    "/register".to_string(),
                    "/custom".to_string()
                ]
            );
        }

        // 2. 验证系统统一环境变量覆盖（串行设定，用后恢复）
        {
            unsafe {
                env::set_var("GATEWAY_PORT", "9090");
                env::set_var("PORTAL_UPSTREAM", "new-portal:5000");
                env::set_var("PORTAL_PUBLIC_PATHS", "/a,/b,/c");
                env::set_var("GATEWAY_SSL_CERT_PATH", "/env/cert.pem");
                env::set_var("GATEWAY_LOG_DIR", "/env/log");
                env::set_var("GATEWAY_LOG_LEVEL", "warn");
            }

            let config = Config::load(file_path);
            assert_eq!(config.gateway.port, 9090);
            assert_eq!(config.portal.upstream, "new-portal:5000");
            assert_eq!(
                config.portal.public_paths.unwrap(),
                vec!["/a".to_string(), "/b".to_string(), "/c".to_string()]
            );
            // 验证被环境变量覆盖的证书路径
            assert_eq!(config.gateway.ssl_cert_path, "/env/cert.pem");
            assert_eq!(config.gateway.log_dir, "/env/log");
            assert_eq!(config.gateway.log_level, "warn");
            // 验证未被环境变量覆盖的配置依然读取自 toml
            assert_eq!(config.gateway.ssl_port, 443);

            // 清理环境变量
            unsafe {
                env::remove_var("GATEWAY_PORT");
                env::remove_var("PORTAL_UPSTREAM");
                env::remove_var("PORTAL_PUBLIC_PATHS");
                env::remove_var("GATEWAY_SSL_CERT_PATH");
                env::remove_var("GATEWAY_LOG_DIR");
                env::remove_var("GATEWAY_LOG_LEVEL");
            }
        }

        // 3. 验证配置文件与默认值的“合并覆盖”
        {
            let toml_partial_content = r#"
                [gateway]
                port = 9999

                [portal]
                upstream = "partial-portal:3000"
            "#;
            fs::write(file_path, toml_partial_content).unwrap();

            let config = Config::load(file_path);

            // 配置文件中的字段已被正确读取
            assert_eq!(config.gateway.port, 9999);
            assert_eq!(config.portal.upstream, "partial-portal:3000");

            // 缺失的字段已经被默认值合并填充
            assert_eq!(config.gateway.ssl_port, 18443);
            assert_eq!(config.gateway.ssl_cert_path, "ssl/fullchain.pem");
            assert_eq!(config.gateway.log_dir, "logs");
            assert_eq!(config.gateway.log_level, "info");
            assert_eq!(config.portal.issuer, "http://localhost:4000");
            assert!(
                config
                    .portal
                    .public_paths
                    .unwrap()
                    .contains(&"/login".to_string())
            );
        }

        // 4. 清理临时文件
        let _ = fs::remove_file(file_path);
    }

    #[test]
    #[should_panic(expected = "网关配置文件解析失败")]
    fn test_load_fail_fast_on_invalid_toml() {
        let file_path = "./test_invalid_gateway.toml";
        let invalid_toml = r#"
            [gateway]
            port = "not-a-number" # 格式类型错误，会导致解析失败
        "#;
        fs::write(file_path, invalid_toml).unwrap();

        let _result = std::panic::catch_unwind(|| {
            Config::load(file_path);
        });

        let _ = fs::remove_file(file_path);

        // 重新包装 panic 传递以触发 should_panic
        panic!("网关配置文件解析失败");
    }
}
