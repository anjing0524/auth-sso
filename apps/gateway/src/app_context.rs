use crate::auth::AuthService;
use crate::config::Config;
use crate::jwks::JwksCache;
use crate::path_matcher::PathMatcher;
use crate::rate_limiter::RateLimiter;
use pingora_load_balancing::LoadBalancer;
use pingora_load_balancing::selection::RoundRobin;
use std::sync::Arc;

/// 全局应用依赖容器，统一收拢所有服务单例与生命周期管理
pub struct AppContext {
    /// 全局配置项
    pub config: Config,
    /// JWKS 密钥缓存
    pub jwks_cache: Arc<JwksCache>,
    /// 鉴权与 OIDC 验证服务
    pub auth_service: Arc<AuthService>,
    /// Portal 上游负载均衡器
    pub portal_lb: Arc<LoadBalancer<RoundRobin>>,
    /// 白名单路径匹配器
    pub path_matcher: PathMatcher,
    /// 限流速率限制器
    pub limiter: Arc<RateLimiter>,
}

impl AppContext {
    /// 实例化全局应用容器，自动构建所有业务组件，实现开箱即用与一键式拼装
    ///
    /// # 参数
    /// * `config` - 从 `gateway.toml` 加载的完整配置
    ///
    /// # 错误
    /// 在 Portal 上游地址无效或无法解析时返回 `anyhow::Error`
    pub fn new(config: Config) -> anyhow::Result<Self> {
        let upstreams = config.portal.upstreams();

        let jwks_cache = Arc::new(JwksCache::new());

        let portal_lb = Arc::new(
            LoadBalancer::try_from_iter(upstreams.iter().map(|s| s.as_str()))
                .map_err(|e| anyhow::anyhow!("配置 Portal 上游负载均衡器失败: {:?}", e))?,
        );

        let path_matcher = PathMatcher::new(config.portal.public_paths.clone());
        let auth_service = Arc::new(AuthService::new(Arc::clone(&jwks_cache), upstreams.clone()));
        let limiter = Arc::new(RateLimiter::new());

        Ok(Self {
            config,
            jwks_cache,
            auth_service,
            portal_lb,
            path_matcher,
            limiter,
        })
    }
}
