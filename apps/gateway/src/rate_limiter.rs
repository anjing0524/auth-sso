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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// 唯一 IP 生成器：`observe` 的计数由**模块级 static** 持有，Rust 测试默认并行，
    /// 同一 IP 会被多个用例共享而互相污染。每个用例取一个专属 IP 即可隔离，
    /// 无需给生产代码加"重置计数器"的测试后门。
    static IP_SEQ: AtomicU32 = AtomicU32::new(1);

    fn unique_ip() -> String {
        // 只做一次原子递增：先 fetch_add 再 load 会让两个线程读到同一序号，
        // 从而生成相同 IP、破坏隔离（本函数的存在意义就是保证唯一）。
        let n = IP_SEQ.fetch_add(1, Ordering::Relaxed);
        format!("10.9.{}.{}", n / 250, n % 250)
    }

    fn limits(auth_max: isize, token_max: isize) -> RateLimitConfig {
        RateLimitConfig {
            auth_max,
            token_max,
        }
    }

    #[test]
    fn untracked_path_never_counts() {
        let l = limits(1, 1);
        // 非 /api/auth/ 路径一律 Untracked，且反复调用也不应产生阻断
        for _ in 0..10 {
            assert_eq!(observe("10.1.0.1", "/", &l), RateDecision::Untracked);
            assert_eq!(observe("10.1.0.1", "/api/me", &l), RateDecision::Untracked);
            assert_eq!(observe("10.1.0.1", "/health", &l), RateDecision::Untracked);
        }
    }

    #[test]
    fn tracked_prefix_does_not_include_lookalike_path() {
        let l = limits(1, 1);
        // `/api/authz/...` 不以 `/api/auth/` 开头，不得被当作认证端点限流
        assert_eq!(
            observe("10.1.0.2", "/api/authz/x", &l),
            RateDecision::Untracked
        );
        // 前缀本身不以 `/` 结尾的近似路径
        assert_eq!(
            observe("10.1.0.2", "/api/auth", &l),
            RateDecision::Untracked
        );
        // 真正的认证子路径被追踪
        assert_eq!(
            observe("10.1.0.2", "/api/auth/login", &l),
            RateDecision::Allowed
        );
    }

    #[test]
    fn token_endpoint_uses_its_own_counter() {
        // token_max=2：token 端点第 3 次阻断
        let l = limits(100, 2);
        let ip = unique_ip();
        assert_eq!(
            observe(&ip, "/api/auth/oauth2/token", &l),
            RateDecision::Allowed
        );
        assert_eq!(
            observe(&ip, "/api/auth/oauth2/token", &l),
            RateDecision::Allowed
        );
        assert_eq!(
            observe(&ip, "/api/auth/oauth2/token", &l),
            RateDecision::Blocked
        );
    }

    #[test]
    fn other_auth_paths_use_the_auth_counter() {
        // auth_max=2：其他 /api/auth/* 第 3 次阻断
        let l = limits(2, 100);
        let ip = unique_ip();
        assert_eq!(observe(&ip, "/api/auth/login", &l), RateDecision::Allowed);
        assert_eq!(observe(&ip, "/api/auth/login", &l), RateDecision::Allowed);
        assert_eq!(observe(&ip, "/api/auth/login", &l), RateDecision::Blocked);
    }

    /// 两个计数器相互独立：打满 token 计数器不影响 auth 计数器
    #[test]
    fn token_and_auth_counters_are_independent() {
        let l = limits(2, 1);
        let ip = unique_ip();
        // 打满 token 计数器
        assert_eq!(
            observe(&ip, "/api/auth/oauth2/token", &l),
            RateDecision::Allowed
        );
        assert_eq!(
            observe(&ip, "/api/auth/oauth2/token", &l),
            RateDecision::Blocked
        );
        // auth 计数器对这个 IP 仍是新的
        assert_eq!(observe(&ip, "/api/auth/login", &l), RateDecision::Allowed);
    }

    /// 不同 IP 的计数互不影响（限流按 IP 维度）
    #[test]
    fn different_ips_have_separate_budgets() {
        let l = limits(1, 1);
        let (ip_a, ip_b) = (unique_ip(), unique_ip());
        assert_eq!(observe(&ip_a, "/api/auth/login", &l), RateDecision::Allowed);
        assert_eq!(observe(&ip_a, "/api/auth/login", &l), RateDecision::Blocked);
        // 另一个 IP 未被牵连
        assert_eq!(observe(&ip_b, "/api/auth/login", &l), RateDecision::Allowed);
    }

    /// 边界：阈值 N 表示**允许前 N 次**（`count <= max`），第 N+1 次才阻断
    #[test]
    fn threshold_allows_exactly_n_requests() {
        let l = limits(3, 100);
        let ip = unique_ip();
        for i in 1..=3 {
            assert_eq!(
                observe(&ip, "/api/auth/anything", &l),
                RateDecision::Allowed,
                "第 {i} 次应在阈值内"
            );
        }
        assert_eq!(
            observe(&ip, "/api/auth/anything", &l),
            RateDecision::Blocked,
            "第 4 次应阻断"
        );
    }

    /// 阈值 0 时首次请求即阻断（fail-closed 配置不应被静默忽略）
    #[test]
    fn zero_threshold_blocks_immediately() {
        let l = limits(0, 0);
        assert_eq!(
            observe(&unique_ip(), "/api/auth/login", &l),
            RateDecision::Blocked
        );
        assert_eq!(
            observe(&unique_ip(), "/api/auth/oauth2/token", &l),
            RateDecision::Blocked
        );
    }

    /// 默认配置下的阈值与文档一致（20/30 req/min），防止默认值被误改
    #[test]
    fn default_limits_match_documented_values() {
        let l = RateLimitConfig::default();
        assert_eq!(l.auth_max, 20);
        assert_eq!(l.token_max, 30);
    }

    /// 默认配置下阈值内的请求放行（用唯一 IP 避免与其它用例互相干扰）
    #[test]
    fn default_limits_allow_first_request() {
        let l = RateLimitConfig::default();
        assert_eq!(
            observe(&unique_ip(), "/api/auth/login", &l),
            RateDecision::Allowed
        );
        assert_eq!(
            observe(&unique_ip(), "/api/auth/oauth2/token", &l),
            RateDecision::Allowed
        );
    }
}
