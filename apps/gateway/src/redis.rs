use std::time::Duration;
use tokio::sync::OnceCell;
use tracing::info;

/// bb8 异步 Redis 连接池类型别名 — 全局共享复用
pub type RedisPool = bb8::Pool<bb8_redis::RedisConnectionManager>;

/// 全局连接池单例（tokio::sync::OnceCell 保证异步场景下真正的 once 初始化）
static POOL: OnceCell<RedisPool> = OnceCell::const_new();

/// 全局 Redis URL（main.rs 启动时通过 init() 写入一次）
static REDIS_URL: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// 启动时调用一次，注册 Redis URL。
///
/// 必须在第一次调用 `get_pool` 之前完成。
pub fn init(url: String) {
    let _ = REDIS_URL.set(url);
}

/// 惰性且线程安全地获取全局 Redis 连接池。
///
/// 首次调用时根据 `init()` 注册的 URL 异步建立连接池；
/// 后续调用直接返回已有实例（`OnceCell` 保证全局只初始化一次，无竞态）。
///
/// Redis URL 未注册或连接池创建失败时返回 `None`（fail-open 降级）。
pub async fn get_pool() -> Option<&'static RedisPool> {
    let url = REDIS_URL.get()?;

    POOL.get_or_try_init(|| async {
        info!("🔄 正在惰性创建 bb8 Redis 连接池 (url={})", url);
        let manager = bb8_redis::RedisConnectionManager::new(url.as_str()).map_err(|e| {
            tracing::error!("❌ Redis URL 解析失败: {}", e);
            e
        })?;

        bb8::Pool::builder()
            .max_size(16)
            .connection_timeout(Duration::from_secs(3))
            .build(manager)
            .await
            .map_err(|e| {
                tracing::error!("❌ bb8 Redis 连接池建立失败: {}", e);
                e
            })
    })
    .await
    .ok()
}
