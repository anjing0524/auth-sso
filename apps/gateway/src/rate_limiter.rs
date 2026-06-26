//! 进程内速率限制器（基于 pingora-limits 官方滑动窗口实现）。
//!
//! 对外只暴露单一 [`RateLimiter::check`]，按路径自动选择限流级别。
//! 使用 Pingora 官方 `Rate` struct（无锁双桶滑动窗口），无额外网络 IO。
//!
//! 分布式限流（多实例共享计数）不在此处处理：本项目 SSO 网关单容器部署，
//! 进程内已满足需求；Redis 连接保留用于 jti 黑名单和续签去重等真正需要
//! 跨实例共享状态的场景。

use std::sync::LazyLock;
use std::time::Duration;

use pingora_limits::rate::Rate;

/// 认证端点进程内滑动窗口限流器（60s 窗口）
static AUTH_RATE: LazyLock<Rate> = LazyLock::new(|| Rate::new(Duration::from_secs(60)));

/// Token 端点进程内滑动窗口限流器（60s 窗口）
static OIDC_TOKEN_RATE: LazyLock<Rate> = LazyLock::new(|| Rate::new(Duration::from_secs(60)));

/// 认证端点限流阈值：20 req/min
const AUTH_MAX: isize = 20;

/// Token 端点限流阈值：30 req/min
const OIDC_TOKEN_MAX: isize = 30;

/// 进程内速率限制器（零状态结构体，所有计数由 static Rate 持有）
pub struct RateLimiter;

impl RateLimiter {
    /// 构造限流器（零成本）
    pub fn new() -> Self {
        Self
    }

    /// 检查指定 IP 对该路径的请求是否放行（同步，无 IO）。
    ///
    /// - 路径未命中任何限流级别时返回 `None`（无限流要求，直接放行）
    /// - `Some(true)` 表示未超限，放行
    /// - `Some(false)` 表示已超限，应返回 429
    pub fn check(&self, ip: &str, path: &str) -> Option<bool> {
        if path == "/api/auth/oauth2/token" {
            let count = OIDC_TOKEN_RATE.observe(&ip, 1);
            Some(count <= OIDC_TOKEN_MAX)
        } else if path.starts_with("/api/auth/") {
            let count = AUTH_RATE.observe(&ip, 1);
            Some(count <= AUTH_MAX)
        } else {
            None
        }
    }
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new()
    }
}
