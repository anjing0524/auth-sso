use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

/// 进程内滑动窗口速率限制器
///
/// 三级限流配置（按路径前缀匹配）：
/// - auth (20/min):  /api/auth/ 下的认证端点
/// - oidc (30/min):  /api/auth/oauth2/token 令牌端点
///
/// 非 auth 路径不在此限流（由 Portal 自身处理）
pub struct RateLimiter {
    /// per-IP 请求时间戳列表，key = ip
    windows: Mutex<HashMap<String, Vec<Instant>>>,
}

/// 限流配置
pub struct LimitConfig {
    pub max_requests: usize,
    pub window_secs: u64,
}

/// 认证端点限流: 20 req/min
pub const AUTH_LIMIT: LimitConfig = LimitConfig {
    max_requests: 20,
    window_secs: 60,
};

/// Token 端点限流: 30 req/min
pub const OIDC_TOKEN_LIMIT: LimitConfig = LimitConfig {
    max_requests: 30,
    window_secs: 60,
};

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            windows: Mutex::new(HashMap::new()),
        }
    }

    /// 检查指定 IP 是否超出限制。
    ///
    /// 返回值: (allowed: bool, remaining: usize)
    pub fn check(&self, ip: &str, config: &LimitConfig) -> (bool, usize) {
        let mut windows = self.windows.lock().unwrap();
        let now = Instant::now();
        let window_dur = std::time::Duration::from_secs(config.window_secs);

        let timestamps = windows.entry(ip.to_string()).or_default();

        // 清理过期时间戳
        timestamps.retain(|t| now.duration_since(*t) < window_dur);

        let count = timestamps.len();
        if count >= config.max_requests {
            // 也添加本次时间戳，保持计数准确
            timestamps.push(now);
            return (false, 0);
        }

        timestamps.push(now);
        let remaining = config.max_requests.saturating_sub(count + 1);
        (true, remaining)
    }

    /// 根据路径选择限流级别
    pub fn select_limit(path: &str) -> Option<&'static LimitConfig> {
        if path == "/api/auth/oauth2/token" {
            Some(&OIDC_TOKEN_LIMIT)
        } else if path.starts_with("/api/auth/") {
            Some(&AUTH_LIMIT)
        } else {
            // 非 auth 路径不限流（由 Portal 自身处理）或由后续通用限流扩展
            None
        }
    }
}
