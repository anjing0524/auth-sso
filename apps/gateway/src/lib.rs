//! Auth-SSO 去中心化安全网关库 (Gateway Library)
//!
//! 基于 Pingora 0.8.0 + ES256 JWKS 离线验签。
//!
//! 本库提供网关的核心可复用组件，包括：
//! - JWT 密码学验签与静默续签 ([`auth`])
//! - JWKS 公钥缓存与 OIDC Discovery ([`jwks`])
//! - 路径分类与 Cookie 处理 ([`path_matcher`], [`cookie`])
//! - 进程内速率限制 ([`rate_limiter`])
//! - 配置管理与上游管理 ([`config`])
//! - 无锁全局指标计数 ([`metrics`])
//! - HTTP → HTTPS 重定向服务 ([`redirect`])
//!
//! # Examples
//!
//! ```ignore
//! # use gateway::config::Config;
//! fn main() -> anyhow::Result<()> {
//!     let config = Config::load("gateway.toml")?;
//!     println!("HTTPS port: {}", config.gateway.ssl_port);
//!     Ok(())
//! }
//! ```

pub mod auth;
pub mod authenticate;
pub mod config;
pub mod cookie;
pub mod gateway;
pub mod http;
pub mod jwks;
pub mod logging;
pub mod metrics;
pub mod path_matcher;
pub mod rate_limiter;
pub mod redirect;
pub mod redis;
