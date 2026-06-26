use std::sync::OnceLock;
use std::time::Duration;
use tracing::info;

/// bb8 异步 Redis 连接池类型别名 — 全局共享复用
pub type RedisPool = bb8::Pool<bb8_redis::RedisConnectionManager>;

/// 全局连接池单例（惰性初始化，首次调用 get_pool 时建立）
static POOL: OnceLock<RedisPool> = OnceLock::new();

/// 全局 Redis URL（main.rs 启动时通过 init() 写入一次）
static REDIS_URL: OnceLock<String> = OnceLock::new();

/// 启动时调用一次，注册 Redis URL。
///
/// 必须在第一次调用 `get_pool` 之前完成，否则连接池无法初始化。
pub fn init(url: String) {
    // 允许重复调用（测试场景），仅第一次生效
    let _ = REDIS_URL.set(url);
}

/// 惰性且线程安全地获取全局 Redis 连接池。
///
/// 首次调用时根据 `init()` 注册的 URL 异步建立连接池；
/// 后续调用直接返回已有实例，无任何锁开销。
///
/// Redis URL 未注册或连接池创建失败时返回 `None`（fail-open 降级）。
pub async fn get_pool() -> Option<&'static RedisPool> {
    // 已初始化：直接返回
    if let Some(pool) = POOL.get() {
        return Some(pool);
    }

    // 未初始化：需要 Redis URL
    let url = REDIS_URL.get()?;

    // 并发情况下多个协程可能同时到达此处，
    // get_or_try_init 不可用（OnceLock 无此方法），
    // 用 tokio::sync::OnceCell 实现真正的异步 once 初始化。
    // 这里采用简单策略：谁先 build 成功谁写入，后来者直接拿已有值。
    info!("🔄 正在惰性创建 bb8 Redis 连接池...");
    let manager = bb8_redis::RedisConnectionManager::new(url.as_str()).ok()?;

    let pool = bb8::Pool::builder()
        .max_size(16)
        .connection_timeout(Duration::from_secs(3))
        .build(manager)
        .await
        .ok()?;

    // 写入失败说明另一个协程已经抢先写入，直接取已有值
    let _ = POOL.set(pool);
    POOL.get()
}
