use log::{info, warn};
use serde::Deserialize;
use std::env;
use std::fs;

/// 网关服务层配置
#[derive(Debug, Deserialize, Clone, PartialEq)]
pub struct GatewayConfig {
    /// HTTP 监听端口，用于重定向
    pub port: u16,
    /// HTTPS 监听端口，用于业务代理
    pub ssl_port: u16,
    /// SSL 证书路径
    pub ssl_cert_path: String,
    /// SSL 密钥路径
    pub ssl_key_path: String,
}

/// Portal 上游及 OIDC 鉴权配置
#[derive(Debug, Deserialize, Clone, PartialEq)]
pub struct PortalConfig {
    /// Portal 上游地址，如 portal:4000
    pub upstream: String,
    /// Portal 的 JWKS 公钥刷新端点 URL
    pub jwks_url: String,
    /// Portal 的 OIDC JWT 校验发行者 (iss)
    pub issuer: String,
}

/// 统一配置结构体，支持从 gateway.toml 解析
#[derive(Debug, Deserialize, Clone, PartialEq)]
pub struct Config {
    pub gateway: GatewayConfig,
    pub portal: PortalConfig,
}

impl Config {
    /// 统一配置加载方法：优先从指定文件读取，若读取或解析失败则使用硬编码默认配置，最后应用环境变量覆盖。
    ///
    /// # 参数
    /// * `path` - 配置文件路径
    pub fn load(path: &str) -> Self {
        let mut config = match fs::read_to_string(path) {
            Ok(content) => match toml::from_str::<Config>(&content) {
                Ok(cfg) => {
                    info!("✅ 成功从配置文件 {} 加载网关配置", path);
                    cfg
                }
                Err(e) => {
                    warn!(
                        "⚠️ 配置文件 {} 解析 TOML 格式失败: {:?}，将使用默认配置",
                        path, e
                    );
                    Config::load_default()
                }
            },
            Err(_) => {
                info!("ℹ️ 配置文件 {} 不存在，将使用默认基础配置", path);
                Config::load_default()
            }
        };

        // 允许通过环境变量覆盖配置以符合 12-factor 设计，方便 Docker / K8s 容器化编排部署
        if let Ok(val) = env::var("GATEWAY_PORT") {
            if let Ok(port) = val.parse::<u16>() {
                info!("环境变量覆盖: GATEWAY_PORT={}", port);
                config.gateway.port = port;
            }
        }
        if let Ok(val) = env::var("GATEWAY_SSL_PORT") {
            if let Ok(port) = val.parse::<u16>() {
                info!("环境变量覆盖: GATEWAY_SSL_PORT={}", port);
                config.gateway.ssl_port = port;
            }
        }
        if let Ok(val) = env::var("SSL_CERT_PATH") {
            info!("环境变量覆盖: SSL_CERT_PATH={}", val);
            config.gateway.ssl_cert_path = val;
        }
        if let Ok(val) = env::var("SSL_KEY_PATH") {
            info!("环境变量覆盖: SSL_KEY_PATH={}", val);
            config.gateway.ssl_key_path = val;
        }
        if let Ok(val) = env::var("PORTAL_UPSTREAM") {
            info!("环境变量覆盖: PORTAL_UPSTREAM={}", val);
            config.portal.upstream = val;
        }
        if let Ok(val) = env::var("PORTAL_JWKS_URL") {
            info!("环境变量覆盖: PORTAL_JWKS_URL={}", val);
            config.portal.jwks_url = val;
        }
        if let Ok(val) = env::var("PORTAL_ISSUER") {
            info!("环境变量覆盖: PORTAL_ISSUER={}", val);
            config.portal.issuer = val;
        }

        config
    }

    /// 获取硬编码的默认网关配置，作为无配置文件时的兜底
    pub fn load_default() -> Self {
        Config {
            gateway: GatewayConfig {
                port: 18080,
                ssl_port: 18443,
                ssl_cert_path: "/tmp/gateway/ssl/fullchain.pem".to_string(),
                ssl_key_path: "/tmp/gateway/ssl/privkey.pem".to_string(),
            },
            portal: PortalConfig {
                upstream: "127.0.0.1:4000".to_string(),
                jwks_url: "http://127.0.0.1:4000/api/auth/.well-known/jwks".to_string(),
                issuer: "http://localhost:4000".to_string(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_all() {
        // 1. 验证默认配置
        {
            let config = Config::load_default();
            assert_eq!(config.gateway.port, 18080);
            assert_eq!(config.gateway.ssl_port, 18443);
            assert_eq!(config.portal.upstream, "127.0.0.1:4000");
        }

        // 2. 验证从 TOML 文件加载
        let file_path = "./test_gateway.toml";
        {
            let toml_content = r#"
                [gateway]
                port = 80
                ssl_port = 443
                ssl_cert_path = "/etc/cert.pem"
                ssl_key_path = "/etc/key.pem"

                [portal]
                upstream = "portal:4000"
                jwks_url = "https://portal/.well-known/jwks"
                issuer = "https://portal"
            "#;
            fs::write(file_path, toml_content).unwrap();

            let config = Config::load(file_path);
            assert_eq!(config.gateway.port, 80);
            assert_eq!(config.gateway.ssl_port, 443);
            assert_eq!(config.gateway.ssl_cert_path, "/etc/cert.pem");
            assert_eq!(config.portal.upstream, "portal:4000");
        }

        // 3. 验证环境变量覆盖（串行设定，并在用完后立刻恢复，避免并发交叉干扰）
        {
            unsafe {
                env::set_var("GATEWAY_PORT", "9090");
                env::set_var("PORTAL_UPSTREAM", "new-portal:5000");
            }

            let config = Config::load(file_path);
            assert_eq!(config.gateway.port, 9090);
            assert_eq!(config.portal.upstream, "new-portal:5000");
            // 验证未被覆盖的配置依然读取 toml
            assert_eq!(config.gateway.ssl_port, 443);
            assert_eq!(config.gateway.ssl_cert_path, "/etc/cert.pem");

            // 清理环境变量
            unsafe {
                env::remove_var("GATEWAY_PORT");
                env::remove_var("PORTAL_UPSTREAM");
            }
        }

        // 4. 清理临时文件
        let _ = fs::remove_file(file_path);
    }
}
