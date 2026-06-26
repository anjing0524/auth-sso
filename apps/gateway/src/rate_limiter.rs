//! 进程内 + Redis 双通道速率限制器。
//!
//! 对外只暴露单一 [`RateLimiter::check`]：内部按「Redis 优先 → 进程内降级」调度，
//! 并按路径自动选择限流级别。Redis 不可用时 fail-open 回落到进程内滑动窗口，
//! 保证单实例仍具基本防护。限流编排逻辑不再泄漏到 Gateway。

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use redis::Script;

use crate::redis::RedisPool;

/// 进程内 + Redis 双通道速率限制器
///
/// 三级限流配置（按路径前缀匹配）：
/// - auth (20/min):  /api/auth/ 下的认证端点
/// - oidc (30/min):  /api/auth/oauth2/token 令牌端点
///
/// 非 auth 路径不在此限流（由 Portal 自身处理）。
pub struct RateLimiter {
    /// 进程内滑动窗口兜底（per-IP 请求时间戳列表），key = ip
    windows: Mutex<HashMap<String, Vec<Instant>>>,
}

/// 不可变的限流配置
#[derive(Debug, Clone)]
pub struct LimitConfig {
    pub max_requests: usize,
    pub window_secs: u64,
}

/// 认证端点限流: 20 req/min
const AUTH_LIMIT: LimitConfig = LimitConfig {
    max_requests: 20,
    window_secs: 60,
};

/// Token 端点限流: 30 req/min
const OIDC_TOKEN_LIMIT: LimitConfig = LimitConfig {
    max_requests: 30,
    window_secs: 60,
};

/// 路径 → (Redis key 前缀, 限流配置) 的单一事实表
///
/// 新增限流级别只需在此追加一行，避免原先 `select_limit` / `select_prefix`
/// 两张并行表必须同步修改的隐患。
fn config_for(path: &str) -> Option<(&'static str, &'static LimitConfig)> {
    if path == "/api/auth/oauth2/token" {
        Some(("oidc", &OIDC_TOKEN_LIMIT))
    } else if path.starts_with("/api/auth/") {
        Some(("auth", &AUTH_LIMIT))
    } else {
        None
    }
}

/// Redis Lua 脚本：原子化滑动窗口限流
///
/// KEYS[1]: 限流 key
/// ARGV[1]: 窗口起始时间 (ms)
/// ARGV[2]: 当前时间 (ms)
/// ARGV[3]: 最大请求数
/// ARGV[4]: key 过期时间 (秒)
///
/// 返回: {allowed (1|0), remaining (int)}
const RATE_LIMIT_LUA: &str = r#"
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
local count = redis.call('ZCARD', KEYS[1])
local max = tonumber(ARGV[3])
if count < max then
    -- 用纳秒级唯一 counter 避免同毫秒 member 碰撞导致计数失真
    local seq = redis.call('INCR', KEYS[1] .. ':seq')
    local member = ARGV[2] .. ':' .. seq
    redis.call('ZADD', KEYS[1], ARGV[2], member)
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
    redis.call('EXPIRE', KEYS[1] .. ':seq', tonumber(ARGV[4]))
    return {1, max - count - 1}
else
    return {0, 0}
end
"#;

/// Lua 脚本单例（Script 内部缓存 SHA，首次 EVAL 后走 EVALSHA，减少网络传输）
static RATE_LIMIT_SCRIPT: LazyLock<Script> = LazyLock::new(|| Script::new(RATE_LIMIT_LUA));

/// Redis 限流的明确判定结果
///
/// 取代原先 `(bool, usize)` 返回值，消除「最后一个允许名额 (remaining=0)」
/// 与「Redis 不可用 fail-open」被同一个 `(true, 0)` 表示 of 歧义。
enum RedisVerdict {
    /// 放行
    Allowed,
    /// 命中限流，拦截
    Blocked,
    /// Redis 不可用或脚本异常，调用方应回落到进程内限流
    FailOpen,
}

impl RateLimiter {
    /// 构造限流器。
    pub fn new() -> Self {
        Self {
            windows: Mutex::new(HashMap::new()),
        }
    }

    /// 检查指定 IP 对该路径的请求是否放行。
    ///
    /// 路径未命中任何限流级别时返回 `None`（无限流要求）；
    /// 否则按 Redis 优先、进程内降级 判定，返回 `Some(true)` 放行 / `Some(false)` 拦截。
    pub async fn check(&self, ip: &str, path: &str) -> Option<bool> {
        let (prefix, config) = config_for(path)?;

        // Redis 优先：失败或不可用时回落到进程内限流（fail-open 仅指 Redis 通道本身）
        if let Some(pool) = crate::redis::get_pool().await {
            match Self::check_redis(pool, ip, prefix, config).await {
                RedisVerdict::Allowed => return Some(true),
                RedisVerdict::Blocked => return Some(false),
                RedisVerdict::FailOpen => {
                    tracing::debug!("Redis 限流降级至进程内: ip={}, path={}", ip, path);
                }
            }
        }

        let (allowed, _remaining) = self.check_in_process(ip, config);
        Some(allowed)
    }

    /// 进程内滑动窗口检查指定 IP 是否超出限制。
    fn check_in_process(&self, ip: &str, config: &LimitConfig) -> (bool, usize) {
        let mut windows = self.windows.lock().unwrap();
        let now = Instant::now();
        let window_dur = Duration::from_secs(config.window_secs);

        // 先清理过期时间戳，空条目自动移除
        windows.retain(|_ip, timestamps| {
            timestamps.retain(|t| now.duration_since(*t) < window_dur);
            !timestamps.is_empty()
        });

        let timestamps = windows.entry(ip.to_string()).or_default();
        let count = timestamps.len();
        if count >= config.max_requests {
            timestamps.push(now);
            return (false, 0);
        }

        timestamps.push(now);
        let remaining = config.max_requests.saturating_sub(count + 1);
        (true, remaining)
    }

    /// 通过 Redis Lua 脚本实现原子化滑动窗口限流。
    ///
    /// EVAL 在 Redis 单线程中原子执行，消除 Pipeline 方式的竞态条件。
    /// 使用 INCR 生成唯一 member 避免同毫秒碰撞。
    async fn check_redis(
        pool: &RedisPool,
        ip: &str,
        path_prefix: &str,
        config: &LimitConfig,
    ) -> RedisVerdict {
        let mut conn = match pool.get().await {
            Ok(c) => c,
            Err(_) => return RedisVerdict::FailOpen, // 连接获取失败 → 降级
        };

        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        let window_start = now_ms.saturating_sub((config.window_secs as i64) * 1000);
        let key = format!("portal:ratelimit:{}:{}", path_prefix, ip);

        // EVAL 原子执行：清理过期 → 计数 → 判罚 → 写入
        let result: Result<(i32, i32), _> = RATE_LIMIT_SCRIPT
            .key(&key)
            .arg(window_start)
            .arg(now_ms)
            .arg(config.max_requests)
            .arg(config.window_secs)
            .invoke_async(&mut *conn)
            .await;

        match result {
            Ok((1, _)) => RedisVerdict::Allowed,
            Ok((0, _)) => RedisVerdict::Blocked,
            Ok(_) => RedisVerdict::FailOpen,  // 非预期返回值 → 降级
            Err(_) => RedisVerdict::FailOpen, // 脚本执行失败 → 降级
        }
    }
}
