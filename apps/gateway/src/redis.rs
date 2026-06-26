//! Redis 基础设施：连接池类型别名与构造。
//!
//! 作为基础设施层独立存在，由 `main.rs` 注入给需要它的模块
//! （`AuthService` 的 jti 黑名单/续签去重、`RateLimiter` 的分布式限流），
//! 避免鉴权模块把连接池借给限流模块这类跨关注点耦合。

use std::time::Duration;

use tracing::{error, info};

/// bb8 异步 Redis 连接池类型别名 — 全局共享复用
pub type RedisPool = bb8::Pool<bb8_redis::RedisConnectionManager>;

/// 在指定运行时句柄上同步阻塞地构建 Redis 连接池。
///
/// 任何环节失败（URL 非法、连接超时等）均返回 `None` 并记录降级日志，
/// 由调用方按 fail-open 策略处理。`bb8::Pool` 内部基于 Arc，
/// 返回值可直接 `.clone()` 分发给多个使用方而共享同一连接池。
///
/// # 参数
/// * `handle` - 任意 tokio 运行时句柄（Pingora 运行时）
/// * `url` - Redis 连接 URL（如 `redis://127.0.0.1:6379`）
pub fn build_pool_blocking(handle: &tokio::runtime::Handle, url: &str) -> Option<RedisPool> {
    let manager = match bb8_redis::RedisConnectionManager::new(url) {
        Ok(m) => m,
        Err(e) => {
            error!(
                "❌ 无法解析 Redis URL ({}): {}。Redis 相关功能将降级 (fail-open)",
                url, e
            );
            return None;
        }
    };

    match handle.block_on(
        bb8::Pool::builder()
            .max_size(16)
            .connection_timeout(Duration::from_secs(3))
            .build(manager),
    ) {
        Ok(pool) => {
            info!("✅ bb8 Redis 连接池初始化成功 (max_size=16)");
            Some(pool)
        }
        Err(e) => {
            error!(
                "❌ bb8 Redis 连接池创建失败: {}。Redis 相关功能将降级 (fail-open)",
                e
            );
            None
        }
    }
}
