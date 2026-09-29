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

use crate::config::RateLimitConfig;
use crate::http::SessionExt;

// ── 限流计数器（进程内静态单例）──

/// 认证端点进程内滑动窗口限流器（60s 窗口）
static AUTH_RATE: LazyLock<Rate> = LazyLock::new(|| Rate::new(Duration::from_secs(60)));

/// Token 端点进程内滑动窗口限流器（60s 窗口）
static OIDC_TOKEN_RATE: LazyLock<Rate> = LazyLock::new(|| Rate::new(Duration::from_secs(60)));

// ── 内部纯函数：判定限流结果 ──

/// 判定路径是否属于限流追踪范围（认证端点）。
///
/// `check()` 的外部守卫与 `observe()` 的内部判定共用一个真相源，
/// 避免两处独立维护路径谓词引起限流静默失效。
fn is_tracked_path(path: &str) -> bool {
    path.starts_with("/api/auth/")
}

/// 限流判定结果。
///
/// 取代原先的 `Option<bool>` 三态反范式（`None`/`Some(true)`/`Some(false)`），
/// 用具名变体让调用点自文档化，并杜绝 `Some(true)` 被误用为"已超限"的风险。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RateDecision {
    /// 该路径未配置限流，直接放行（不消耗任何计数）。
    Untracked,
    /// 命中限流窗口且当前计数未超限，允许通过。
    Allowed,
    /// 已超过窗口阈值，应返回 429。
    Blocked,
}

/// 观察指定 IP 对该路径的一次请求，返回限流判定（同步，无 IO）。
///
/// 阈值来自配置（[`RateLimitConfig`]），默认 20/30 req/min，
/// E2E 通过 RATE_LIMIT_* 环境变量覆盖。
///
/// 仅对认证相关端点（`/api/auth/oauth2/token` 与 `/api/auth/*`）生效；
/// 其余路径返回 [`RateDecision::Untracked`]，不触碰任何计数器。
///
/// # Examples
///
/// ```
/// # use gateway::rate_limiter::{observe, RateDecision};
/// # use gateway::config::RateLimitConfig;
/// let limits = RateLimitConfig::default();
/// // 非限流路径
/// assert_eq!(observe("10.0.0.1", "/", &limits), RateDecision::Untracked);
/// // 首次请求未超限
/// assert_eq!(observe("10.0.0.2", "/api/auth/oauth2/token", &limits), RateDecision::Allowed);
/// ```
pub fn observe(ip: &str, path: &str, limits: &RateLimitConfig) -> RateDecision {
    // Rate::observe 要求 T: Hash + Sized，传入 &&str 使 T = &str（Sized）
    if path == "/api/auth/oauth2/token" {
        let count = OIDC_TOKEN_RATE.observe(&ip, 1);
        if count <= limits.token_max {
            RateDecision::Allowed
        } else {
            RateDecision::Blocked
        }
    } else if is_tracked_path(path) {
        let count = AUTH_RATE.observe(&ip, 1);
        if count <= limits.auth_max {
            RateDecision::Allowed
        } else {
            RateDecision::Blocked
        }
    } else {
        RateDecision::Untracked
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
/// if rate_limiter::check(session, "203.0.113.10").await? {
///     return Ok(true); // 已触发限流，短路
/// }
/// ```
pub async fn check(
    session: &mut Session,
    client_ip: &str,
    limits: &RateLimitConfig,
) -> Result<bool> {
    let path = session.req_header().uri.path();
    if !is_tracked_path(path) {
        return Ok(false);
    }

    if matches!(observe(client_ip, path, limits), RateDecision::Blocked) {
        warn!("速率限制触发: ip={}, path={}", client_ip, path);
        crate::metrics::inc_rate_limited();
        session.respond_429(60).await?;
        return Ok(true);
    }

    Ok(false)
}
