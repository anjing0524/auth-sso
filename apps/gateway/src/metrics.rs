//! 网关运行指标计数器（基于 AtomicU64 的无锁全局计数器）。
//!
//! 所有计数器均使用 `Ordering::Relaxed` — 我们只需要最终一致性用于日志快照，
//! 不需要精确的 happens-before 关系。每次递增均 O(1)，对热路径无显著影响。

use std::sync::atomic::{AtomicU64, Ordering};

// ── 计数器定义 ──

static REQUESTS_TOTAL: AtomicU64 = AtomicU64::new(0);
static AUTH_FAILURES_TOTAL: AtomicU64 = AtomicU64::new(0);
static RATE_LIMITED_TOTAL: AtomicU64 = AtomicU64::new(0);
static JTI_REVOKED_TOTAL: AtomicU64 = AtomicU64::new(0);
static REFRESH_SUCCESS_TOTAL: AtomicU64 = AtomicU64::new(0);
static REFRESH_FAILURE_TOTAL: AtomicU64 = AtomicU64::new(0);

// ── 递增函数（热路径友好）──

#[inline]
pub fn inc_requests() {
    REQUESTS_TOTAL.fetch_add(1, Ordering::Relaxed);
}

#[inline]
pub fn inc_auth_failures() {
    AUTH_FAILURES_TOTAL.fetch_add(1, Ordering::Relaxed);
}

#[inline]
pub fn inc_rate_limited() {
    RATE_LIMITED_TOTAL.fetch_add(1, Ordering::Relaxed);
}

#[inline]
pub fn inc_jti_revoked() {
    JTI_REVOKED_TOTAL.fetch_add(1, Ordering::Relaxed);
}

#[inline]
pub fn inc_refresh_success() {
    REFRESH_SUCCESS_TOTAL.fetch_add(1, Ordering::Relaxed);
}

#[inline]
pub fn inc_refresh_failure() {
    REFRESH_FAILURE_TOTAL.fetch_add(1, Ordering::Relaxed);
}

/// 输出当前指标快照到日志（info 级别），每 5 分钟由 JWKS 刷新循环触发。
pub fn log_snapshot() {
    tracing::info!(
        "📊 网关指标: req={} auth_fail={} rate_limit={} jti_revoke={} refresh_ok={} refresh_fail={}",
        REQUESTS_TOTAL.load(Ordering::Relaxed),
        AUTH_FAILURES_TOTAL.load(Ordering::Relaxed),
        RATE_LIMITED_TOTAL.load(Ordering::Relaxed),
        JTI_REVOKED_TOTAL.load(Ordering::Relaxed),
        REFRESH_SUCCESS_TOTAL.load(Ordering::Relaxed),
        REFRESH_FAILURE_TOTAL.load(Ordering::Relaxed),
    );
}
