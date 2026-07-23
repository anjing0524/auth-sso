//! 网关运行指标计数器（基于 AtomicU64 的无锁全局计数器）。
//!
//! 所有计数器均使用 `Ordering::Relaxed` — 我们只需要最终一致性用于日志快照，
//! 不需要精确的 happens-before 关系。每次递增均 O(1)，对热路径无显著影响。

use std::sync::atomic::{AtomicU64, Ordering};

// ── Redis 连接池指标 ──

static REDIS_POOL_IDLE: AtomicU64 = AtomicU64::new(0);
static REDIS_POOL_TOTAL: AtomicU64 = AtomicU64::new(0);
static REDIS_POOL_WAIT_MS: AtomicU64 = AtomicU64::new(0);
static REDIS_ACQUIRE_FAILURES: AtomicU64 = AtomicU64::new(0);

static JWKS_LAST_SUCCESS_TS: AtomicU64 = AtomicU64::new(0);

#[inline]
#[allow(dead_code)]
pub fn set_redis_pool_idle(n: u64) {
    REDIS_POOL_IDLE.store(n, Ordering::Relaxed);
}

#[inline]
#[allow(dead_code)]
pub fn set_redis_pool_total(n: u64) {
    REDIS_POOL_TOTAL.store(n, Ordering::Relaxed);
}

#[inline]
#[allow(dead_code)]
pub fn record_redis_acquire_wait_ms(ms: u64) {
    REDIS_POOL_WAIT_MS.store(ms, Ordering::Relaxed);
}

#[inline]
pub fn inc_redis_acquire_failures() {
    REDIS_ACQUIRE_FAILURES.fetch_add(1, Ordering::Relaxed);
}

#[inline]
pub fn record_jwks_refresh_success() {
    JWKS_LAST_SUCCESS_TS.store(
        crate::http::unix_secs().unwrap_or_default(),
        Ordering::Relaxed,
    );
}

/// JWKS 缓存陈旧度（自上次成功刷新以来的秒数），0 表示从未成功
pub fn jwks_cache_staleness_secs() -> u64 {
    let last = JWKS_LAST_SUCCESS_TS.load(Ordering::Relaxed);
    if last == 0 {
        return 0;
    }
    let now = crate::http::unix_secs().unwrap_or_default();
    now.saturating_sub(last)
}

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
        "📊 网关指标: req={} auth_fail={} rate_limit={} jti_revoke={} refresh_ok={} refresh_fail={} redis_idle={} redis_total={} acquire_wait_ms={} acquire_fail={} jwks_stale_sec={}",
        REQUESTS_TOTAL.load(Ordering::Relaxed),
        AUTH_FAILURES_TOTAL.load(Ordering::Relaxed),
        RATE_LIMITED_TOTAL.load(Ordering::Relaxed),
        JTI_REVOKED_TOTAL.load(Ordering::Relaxed),
        REFRESH_SUCCESS_TOTAL.load(Ordering::Relaxed),
        REFRESH_FAILURE_TOTAL.load(Ordering::Relaxed),
        REDIS_POOL_IDLE.load(Ordering::Relaxed),
        REDIS_POOL_TOTAL.load(Ordering::Relaxed),
        REDIS_POOL_WAIT_MS.load(Ordering::Relaxed),
        REDIS_ACQUIRE_FAILURES.load(Ordering::Relaxed),
        jwks_cache_staleness_secs(),
    );
}
