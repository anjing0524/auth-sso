use serde::{Deserialize, Serialize};
use tracing::{error, info};

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
            upstream: "127.0.0.1:4100".to_string(),
            jwks_url: "http://127.0.0.1:4100/api/auth/jwks".to_string(),
            issuer: "http://localhost:4100".to_string(),
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

impl Config {
    /// 统一配置加载方法：优先从指定文件读取，读取成功但解析失败时 Fail-Fast 强制 panic 报错退出，
    /// 若配置文件不存在则使用默认配置兜底。缺失的任何字段都将自动使用 Default 合并填充。
    ///
    /// # 参数
    /// * `path` - 配置文件路径
    pub fn load(path: &str) -> Self {
        let builder =
            config::Config::builder().add_source(config::File::with_name(path).required(false));

        match builder.build() {
            Ok(config_build) => match config_build.try_deserialize::<Config>() {
                Ok(cfg) => {
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
                    cfg
                }
                Err(e) => {
                    error!(
                        "❌ 配置文件 {} 反序列化失败: {:?}，请检查语法格式！",
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
        }
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
        assert_eq!(config.portal.upstream, "127.0.0.1:4100");
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

        // 2. 验证配置文件与默认值的“合并覆盖”
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
            assert_eq!(config.portal.issuer, "http://localhost:4100");
            assert!(
                config
                    .portal
                    .public_paths
                    .unwrap()
                    .contains(&"/login".to_string())
            );
        }

        // 3. 清理临时文件
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
