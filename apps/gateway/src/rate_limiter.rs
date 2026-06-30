//! 进程内速率限制器（基于 pingora-limits 官方滑动窗口实现）。
//!
//! 按路径自动选择限流级别，使用 Pingora 官方 `Rate` struct（无锁双桶滑动窗口），
//! 无额外网络 IO。所有计数由模块级 static `LazyLock<Rate>` 持有。
//!
//! 分布式限流（多实例共享计数）不在此处处理：本项目 SSO 网关单容器部署，
//! 进程内已满足需求；Redis 连接保留用于 jti 黑名单和续签去重等真正需要
//! 跨实例共享状态的场景。

use std::sync::LazyLock;
use std::time::Duration;

use pingora_core::Result;
use pingora_limits::rate::Rate;
use pingora_proxy::Session;
use tracing::warn;

use crate::http::SessionExt;

// ── 限流计数器（进程内静态单例）──

/// 认证端点进程内滑动窗口限流器（60s 窗口）
static AUTH_RATE: LazyLock<Rate> = LazyLock::new(|| Rate::new(Duration::from_secs(60)));

/// Token 端点进程内滑动窗口限流器（60s 窗口）
static OIDC_TOKEN_RATE: LazyLock<Rate> = LazyLock::new(|| Rate::new(Duration::from_secs(60)));

/// 认证端点限流阈值：20 req/min
const AUTH_MAX: isize = 20;

/// Token 端点限流阈值：30 req/min
const OIDC_TOKEN_MAX: isize = 30;

// ── 内部纯函数：判断是否超限 ──

/// 检查指定 IP 对该路径的请求是否超限（同步，无 IO）。
///
/// - `None` — 路径未命中任何限流级别，直接放行
/// - `Some(true)` — 未超限，放行
/// - `Some(false)` — 已超限，应返回 429
///
/// # Examples
///
/// ```
/// # use gateway::rate_limiter::is_over_limit;
/// assert!(is_over_limit("10.0.0.1", "/").is_none());
/// let result = is_over_limit("10.0.0.2", "/api/auth/oauth2/token");
/// assert!(result.is_some());
/// assert_eq!(result, Some(true)); // 首次请求未超限
/// ```
pub fn is_over_limit(ip: &str, path: &str) -> Option<bool> {
    // Rate::observe 要求 T: Hash + Sized，传入 &&str 使 T = &str（Sized）
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

// ── 公开 API：限流拦截 ──

/// 速率限制拦截校验，保护认证端点防止爆刷。
///
/// 返回值遵循 Pingora 原生 `Result<bool>` 协议：
/// - `Ok(true)` — 已响应 429，上层应短路
/// - `Ok(false)` — 未触发限流，继续处理
///
/// # Errors
///
/// 仅在写入 429 响应体失败时返回 I/O 错误。
///
/// # Examples
///
/// ```ignore
/// // 在 request_filter 热路径上调用：
/// if rate_limiter::check(session).await? {
///     return Ok(true); // 已触发限流，短路
/// }
/// ```
pub async fn check(session: &mut Session) -> Result<bool> {
    let path = session.req_header().uri.path();
    let ip = session.client_ip().unwrap_or("unknown");

    if let Some(false) = is_over_limit(ip, path) {
        warn!("速率限制触发: ip={}, path={}", ip, path);
        crate::metrics::inc_rate_limited();
        session.respond_429(60).await?;
        return Ok(true);
    }

    Ok(false)
}
