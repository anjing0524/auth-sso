use anyhow::Context;
use async_trait::async_trait;
use pingora_core::server::ShutdownWatch;
use pingora_core::services::ServiceReadyNotifier;
use pingora_core::services::background::BackgroundService;
use std::sync::OnceLock;
use std::time::Duration;
use tracing::{error, info};

use crate::config::RedisConfig;

/// bb8 异步 Redis 连接池类型别名 — 全局共享复用
pub type RedisPool = bb8::Pool<bb8_redis::RedisConnectionManager>;

/// 全局连接池单例，初始化后通过 OnceLock 变成只读，提供 O(1) 级别的快速无锁访问
static POOL: OnceLock<RedisPool> = OnceLock::new();

/// 异步初始化 Redis 连接池并预热连接。
///
/// 使用 `build()` 真正建立 Redis 连接（而非 `build_unchecked` 的空壳），
/// 在 `connection_timeout` 内连不上则直接失败。由 [`RedisInitService`] 在
/// Pingora Service 生命周期中调用，调用方负责 fail-fast。
async fn init_async(cfg: &RedisConfig) -> anyhow::Result<()> {
    // 日志中仅输出主机信息，避免凭据泄漏
    let masked_url = cfg.url.split('@').next_back().unwrap_or("localhost");
    info!(
        "🔄 正在异步初始化 bb8 Redis 连接池 (host={}, max_size={})",
        masked_url, cfg.pool_max_size
    );
    let manager =
        bb8_redis::RedisConnectionManager::new(cfg.url.as_str()).context("Redis URL 解析失败")?;

    let pool = bb8::Pool::builder()
        .max_size(cfg.pool_max_size)
        .min_idle(Some(cfg.pool_min_idle))
        .max_lifetime(Some(Duration::from_secs(cfg.pool_max_lifetime_sec)))
        .idle_timeout(Some(Duration::from_secs(cfg.pool_idle_timeout_sec)))
        .connection_timeout(Duration::from_secs(cfg.pool_connection_timeout_sec))
        .build(manager)
        .await
        .context("Redis 连接池 build 失败，无法连接到 Redis")?;

    POOL.set(pool)
        .map_err(|_| anyhow::anyhow!("Redis 连接池已被初始化过"))?;
    info!("✅ Redis 连接池异步初始化成功（已预热连接）");
    Ok(())
}

/// 快速且线程安全地获取全局 Redis 连接池。
///
/// 运行在请求的热路径上，此函数为同步无锁获取。
/// 返回 `None` 表示连接池未建立（正常启动流程中不会发生）。
pub fn pool() -> Option<&'static RedisPool> {
    POOL.get()
}

// ── Redis 命令辅助函数 ──
//
// 以下函数封装了「获取连接 → 执行命令 → 错误处理」的通用模式，
// jti 黑名单检查采用 fail-close 语义：Redis 不可用时拒绝请求（安全优先）。
// 其他辅助函数（acquire_nx_ex / del）保持 fail-open 语义。

/// 获取一条 Redis 连接；连接池未就绪或获取失败时返回 None。
async fn get_conn() -> Option<bb8::PooledConnection<'static, bb8_redis::RedisConnectionManager>> {
    let pool = pool().or_else(|| {
        tracing::warn!("Redis 连接池未就绪，降级");
        None
    })?;
    pool.get()
        .await
        .map_err(|e| tracing::warn!("Redis 连接获取失败，降级: {:?}", e))
        .ok()
}

/// 检查 key 是否存在于 Redis（EXISTS 命令），fail-close：Redis 不可用时返回 true
///
/// jti 黑名单专用：Redis 不可用时假定 key 存在（即 jti 已被撤销），
/// 拒绝请求以保障安全。与 acquire_nx_ex/del 的 fail-open 语义不同——
/// jti 检查是安全边界，不可降级放行。
///
/// # Examples
///
/// ```ignore
/// if redis::exists("portal:jti_blocklist:some-jti").await {
///     // key 存在（Redis 可用时）或 Redis 不可用（fail-close 假定已撤销）
/// }
/// ```
pub async fn exists(key: &str) -> bool {
    let mut conn = match get_conn().await {
        Some(c) => c,
        None => {
            tracing::warn!(
                "Redis EXISTS 降级返回 true（fail-close：连接池未就绪，假定 jti 已撤销）"
            );
            return true;
        }
    };
    match redis::cmd("EXISTS")
        .arg(key)
        .query_async::<i32>(&mut *conn)
        .await
    {
        Ok(count) => count > 0,
        Err(e) => {
            tracing::warn!("Redis EXISTS 异常: {:?}，降级返回 true（fail-close）", e);
            true
        }
    }
}

/// SET key value NX EX ttl，返回是否抢占成功。fail-open：Redis 不可用时返回 true（允许续签）。
///
/// SET NX 在 key 已存在时返回 nil（`None`），抢占成功时返回 `Some("OK")`——
/// 「检查 + 写入」在 Redis 服务端单命令原子完成，消除检查-后写的 TOCTOU 窗口。
pub async fn acquire_nx_ex(key: &str, value: &str, ttl_secs: u64) -> bool {
    let Some(mut conn) = get_conn().await else {
        return true;
    };
    match redis::cmd("SET")
        .arg(key)
        .arg(value)
        .arg("NX")
        .arg("EX")
        .arg(ttl_secs as i64)
        .query_async::<Option<String>>(&mut *conn)
        .await
    {
        Ok(reply) => reply.is_some(), // Some("OK") = 抢到
        Err(e) => {
            tracing::warn!("Redis SET NX EX 异常: {:?}，降级放行", e);
            true
        }
    }
}

/// DEL key，fail-open 静默忽略（续签失败时释放去重锁，允许下次立即重试）
pub async fn del(key: &str) {
    let Some(mut conn) = get_conn().await else {
        return;
    };
    if let Err(e) = redis::cmd("DEL")
        .arg(key)
        .query_async::<()>(&mut *conn)
        .await
    {
        tracing::warn!("Redis DEL 异常: {:?}，降级忽略", e);
    }
}

// ── Redis 初始化 Service ──

/// Pingora Service：利用 Service 生命周期在启动阶段初始化 Redis 连接池并预热连接。
///
/// 覆盖 `start_with_ready_notifier` 以**先完成初始化、再通知就绪**，
/// 确保声明了依赖此 Service 的下游服务（如 Gateway Proxy）在 Redis 完全就绪前
/// 不会接收流量。初始化失败直接 `process::exit(1)`，阻止网关带错上线。
#[derive(Debug)]
pub struct RedisInitService {
    config: RedisConfig,
}

impl RedisInitService {
    pub fn new(config: RedisConfig) -> Self {
        Self { config }
    }
}

#[async_trait]
impl BackgroundService for RedisInitService {
    async fn start_with_ready_notifier(
        &self,
        _shutdown: ShutdownWatch,
        ready_notifier: ServiceReadyNotifier,
    ) {
        if let Err(e) = init_async(&self.config).await {
            error!("❌ Redis 初始化失败，终止启动: {:?}", e);
            std::process::exit(1);
        }
        ready_notifier.notify_ready();
    }
}
