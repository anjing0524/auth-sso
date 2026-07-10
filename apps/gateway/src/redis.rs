use anyhow::Context;
use async_trait::async_trait;
use pingora_core::server::ShutdownWatch;
use pingora_core::services::ServiceReadyNotifier;
use pingora_core::services::background::BackgroundService;
use std::sync::OnceLock;
use std::time::Duration;
use tracing::{error, info};

/// bb8 异步 Redis 连接池类型别名 — 全局共享复用
pub type RedisPool = bb8::Pool<bb8_redis::RedisConnectionManager>;

/// 全局连接池单例，初始化后通过 OnceLock 变成只读，提供 O(1) 级别的快速无锁访问
static POOL: OnceLock<RedisPool> = OnceLock::new();

/// 异步初始化 Redis 连接池并预热连接。
///
/// 使用 `build()` 真正建立 Redis 连接（而非 `build_unchecked` 的空壳），
/// 在 `connection_timeout` 内连不上则直接失败。由 [`RedisInitService`] 在
/// Pingora Service 生命周期中调用，调用方负责 fail-fast。
async fn init_async(url: &str) -> anyhow::Result<()> {
    info!("🔄 正在异步初始化 bb8 Redis 连接池 (url={})", url);
    let manager = bb8_redis::RedisConnectionManager::new(url).context("Redis URL 解析失败")?;

    let pool = bb8::Pool::builder()
        .max_size(16)
        .min_idle(Some(4))
        .max_lifetime(Some(Duration::from_secs(1800)))
        .idle_timeout(Some(Duration::from_secs(300)))
        .connection_timeout(Duration::from_secs(3))
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
// 统一采用 fail-open（降级放行）语义：Redis 不可用时返回安全默认值。

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

/// 检查 key 是否存在于 Redis（EXISTS 命令）
///
/// # Examples
///
/// ```ignore
/// let found = redis::exists("portal:jti_blocklist:some-jti").await?;
/// ```
pub async fn exists(key: &str) -> anyhow::Result<bool> {
    let pool = pool().context("Redis 连接池未就绪")?;
    let mut conn = pool.get().await.context("Redis 连接获取失败")?;
    let count: i32 = redis::cmd("EXISTS")
        .arg(key)
        .query_async(&mut *conn)
        .await
        .context("Redis EXISTS 命令执行失败")?;
    Ok(count > 0)
}

/// 从 Redis 获取一个字符串值（GET 命令），fail-open 返回 None
///
/// # Examples
///
/// ```ignore
/// let cached = redis::get("portal:refresh_dedup:user-1").await;
/// ```
pub async fn get(key: &str) -> Option<String> {
    let mut conn = get_conn().await?;
    match redis::cmd("GET").arg(key).query_async(&mut *conn).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("Redis GET 异常: {:?}，降级返回 None", e);
            None
        }
    }
}

/// 原子写入 Redis（SET key value NX EX ttl），fail-open 静默忽略
pub async fn set_nx_ex(key: &str, value: &str, ttl_secs: u64) {
    let Some(mut conn) = get_conn().await else {
        return;
    };
    if let Err(e) = redis::cmd("SET")
        .arg(key)
        .arg(value)
        .arg("NX")
        .arg("EX")
        .arg(ttl_secs as i64)
        .query_async::<()>(&mut *conn)
        .await
    {
        tracing::warn!("Redis SET NX EX 异常: {:?}，降级忽略", e);
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
    url: String,
}

impl RedisInitService {
    pub fn new(url: String) -> Self {
        Self { url }
    }
}

#[async_trait]
impl BackgroundService for RedisInitService {
    async fn start_with_ready_notifier(
        &self,
        _shutdown: ShutdownWatch,
        ready_notifier: ServiceReadyNotifier,
    ) {
        if let Err(e) = init_async(&self.url).await {
            error!("❌ Redis 初始化失败，终止启动: {:?}", e);
            std::process::exit(1);
        }
        ready_notifier.notify_ready();
    }
}
