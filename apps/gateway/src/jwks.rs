use arc_swap::ArcSwap;
use jsonwebtoken::Algorithm;
use jsonwebtoken::DecodingKey;
use jsonwebtoken::Validation;
use jsonwebtoken::jwk::JwkSet;
use pingora_core::server::ShutdownWatch;
use pingora_core::services::background::BackgroundService;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tracing::{info, warn};

use crate::config::Upstreams;
use crate::http::HTTP_CLIENT;

/// JWKS 获取与解析过程中的强类型错误定义
#[derive(thiserror::Error, Debug)]
pub enum JwksError {
    /// 网络请求或解析 JSON 失败
    #[error("网络或 JSON 解析错误: {0}")]
    Network(#[from] reqwest::Error),
    /// 响应中不含任何合法的公钥
    #[error("JWKS 响应中未找到任何有效且可解析的公钥")]
    EmptyKeys,
    /// 未配置任何上游地址，无法执行 OIDC Discovery
    #[error("未配置任何上游地址，无法执行 OIDC Discovery")]
    NoUpstreams,
    /// OIDC Discovery 端点返回的 jwks_uri 缺失
    #[error("OIDC Discovery 响应中未包含有效的 jwks_uri")]
    MissingJwksUri,
    /// jwks_uri 路径解析失败
    #[error("无法从 jwks_uri 中解析出 JWKS 路径: {0}")]
    InvalidJwksUri(String),
}

/// OIDC Discovery 拉取结果 — 不含公钥，待 JWKS 公钥也拉取成功后一并原子写入缓存
struct OidcDiscovery {
    validation: Arc<Validation>,
    refresh_endpoint: Option<Arc<str>>,
    jwks_uri: String,
    /// Gateway 拦截 OAuth callback 的路径（来自 OIDC Discovery 自定义字段）
    callback_path: Option<Arc<str>>,
}

/// 构造网关统一的 JWT 校验基线配置：ES256 算法、不校验 aud/exp。
///
/// exp 由网关自行判定（`Valid`/`NearlyExpired`/`Expired` 三态），故关闭
/// jsonwebtoken 的内置 exp 校验；aud 的校验职责在 Portal 侧。issuer 与算法
/// 列表由调用方在 OIDC Discovery 后追加设置。
///
/// 提取此函数以消除原先散落在 4 处的相同三行构造，规避配置漂移风险。
fn base_validation() -> Validation {
    let mut validation = Validation::new(Algorithm::ES256);
    validation.validate_aud = false;
    validation.validate_exp = false;
    validation
}

/// OIDC 元数据 — 公钥映射 + 校验配置 + Discovery 派生端点的不可变快照。
///
/// 整个结构体以 `Arc<OidcMetadata>` 形式存入 [`ArcSwap`]，
/// 热路径一次 wait-free load 同时获得全部字段，零锁零拷贝。
#[derive(Clone)]
pub(crate) struct OidcMetadata {
    /// kid -> 公钥映射表
    pub(crate) keys: HashMap<String, DecodingKey>,
    /// 预构建的 JWT 校验配置（Arc 共享引用，热路径仅原子引用计数递增，零拷贝）
    pub(crate) validation: Arc<Validation>,
    /// Token 刷新接口端点 URL (已解析为完整内网 URL)
    pub(crate) refresh_endpoint: Option<Arc<str>>,
    /// Gateway 拦截 OAuth callback 的路径（来自 OIDC Discovery `oauth_callback_path` 字段）
    pub(crate) callback_path: Option<Arc<str>>,
}

impl Default for OidcMetadata {
    fn default() -> Self {
        Self {
            keys: HashMap::new(),
            validation: Arc::new(base_validation()),
            refresh_endpoint: None,
            callback_path: None,
        }
    }
}

/// JWKS 公钥缓存结构体
///
/// 采用 [`ArcSwap`] 快照设计：读写比极端悬殊（300s 写一次 vs 每请求读），
/// 热路径 `snapshot()` 为一次 wait-free 原子 load，无锁、无中毒可能、零拷贝。
pub struct JwksCache {
    inner: ArcSwap<OidcMetadata>,
}

impl std::fmt::Debug for JwksCache {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("JwksCache").finish_non_exhaustive()
    }
}

impl Default for JwksCache {
    fn default() -> Self {
        Self::new()
    }
}

impl JwksCache {
    /// 创建空的 JWKS 缓存实例
    ///
    /// # Examples
    ///
    /// ```
    /// # use gateway::jwks::JwksCache;
    /// let cache = JwksCache::new();
    /// ```
    pub fn new() -> Self {
        Self {
            inner: ArcSwap::from_pointee(OidcMetadata::default()),
        }
    }

    /// 热路径快照：一次 wait-free load 同时获得 keys + validation，零锁零拷贝
    pub(crate) fn snapshot(&self) -> Arc<OidcMetadata> {
        self.inner.load_full()
    }

    /// 获取特定 kid 对应的公钥（同步读取）
    ///
    /// # Examples
    ///
    /// ```
    /// # use gateway::jwks::JwksCache;
    /// let cache = JwksCache::new();
    /// assert!(cache.key("nonexistent").is_none());
    /// ```
    pub fn key(&self, kid: &str) -> Option<DecodingKey> {
        self.inner.load().keys.get(kid).cloned()
    }

    /// 获取预构建的 OIDC 校验配置（Arc 共享引用，热路径原子引用计数递增，零拷贝）
    pub fn validation(&self) -> Arc<Validation> {
        Arc::clone(&self.inner.load().validation)
    }

    /// 获取缓存的 Token 刷新接口端点 URL (只读共享指针)
    pub fn refresh_endpoint(&self) -> Option<Arc<str>> {
        self.inner.load().refresh_endpoint.clone()
    }

    /// 获取 OIDC Discovery 中声明的 OAuth callback 路径，缓存未就绪时返回默认值。
    ///
    /// 这是 Gateway 自身的 OAuth callback 拦截路径，通过 OIDC Discovery 从 Portal 动态获取，
    /// 属于 Gateway 本地配置而非 OIDC 标准字段。Portal 在 `.well-known/openid-configuration`
    /// 中以自定义字段 `oauth_callback_path` 声明此值。
    pub fn callback_path_or_default(&self) -> Arc<str> {
        self.inner
            .load()
            .callback_path
            .clone()
            .unwrap_or_else(|| Arc::from("/api/auth/callback"))
        // ↑ 兜底值与 Portal Discovery `oauth_callback_path` 声明值
        // 及 Portal callback 路由路径保持一致；变更时需三方同步
    }

    /// 判断当前公钥缓存是否为空
    pub(crate) fn is_empty(&self) -> bool {
        self.inner.load().keys.is_empty()
    }

    /// 将单个 OIDC 字符串算法名转为 `Algorithm`；不支持的算法记录告警并返回 None。
    ///
    /// 注意：`validation.algorithms` 硬锁为 `ES256` 仅（防 alg 混淆攻击），
    /// 此函数仅用于测试注入（`set_metadata_for_test`），生产路径不调用。
    fn parse_algorithm(alg: &str) -> Option<Algorithm> {
        match alg {
            "ES256" => Some(Algorithm::ES256),
            "ES384" => Some(Algorithm::ES384),
            "RS256" => Some(Algorithm::RS256),
            "RS384" => Some(Algorithm::RS384),
            "RS512" => Some(Algorithm::RS512),
            "PS256" => Some(Algorithm::PS256),
            "PS384" => Some(Algorithm::PS384),
            "PS512" => Some(Algorithm::PS512),
            "HS256" => Some(Algorithm::HS256),
            "HS384" => Some(Algorithm::HS384),
            "HS512" => Some(Algorithm::HS512),
            "EdDSA" => Some(Algorithm::EdDSA),
            _ => {
                warn!("OIDC Discovery 返回不支持的签名算法: {}", alg);
                None
            }
        }
    }

    /// 拉取 OIDC Discovery 元数据并解析，不写入缓存（纯读取 + 解析）
    ///
    /// 返回解析后的 validation、refresh_endpoint 和 jwks_uri，
    /// 待 JWKS 公钥也拉取成功后由 `apply_discovery` 一并原子写入。
    ///
    /// # 参数
    /// * `upstream` - Portal 上游地址（如 127.0.0.1:4100）
    /// * `scheme` - 内部上游请求协议（http/https），启动期显式注入
    async fn fetch_oidc_metadata(
        &self,
        upstream: &str,
        scheme: &str,
    ) -> Result<OidcDiscovery, JwksError> {
        let discovery_url = format!("{}://{}/.well-known/openid-configuration", scheme, upstream);
        info!("🔍 通过 OIDC Discovery 获取元数据: {}", discovery_url);

        let resp = HTTP_CLIENT.get(&discovery_url).send().await?;
        let metadata_val: serde_json::Value = resp.json().await?;

        // 提取并校验必要字段
        let jwks_uri = metadata_val
            .get("jwks_uri")
            .and_then(|v| v.as_str())
            .ok_or(JwksError::MissingJwksUri)?;

        let issuer = metadata_val.get("issuer").and_then(|v| v.as_str());
        if issuer.is_none() {
            warn!("⚠️  OIDC Discovery 响应中未包含 issuer 字段");
        }

        let signing_algs_val = metadata_val.get("id_token_signing_alg_values_supported");
        info!(
            "📋 OIDC 元数据已获取: issuer={:?}, jwks_uri={:?}, signing_algs={:?}",
            issuer, jwks_uri, signing_algs_val
        );

        // 预解析 validation（不写缓存，仅返回）：基线配置 + issuer + ES256 硬锁
        let mut validation = base_validation();
        if let Some(iss) = issuer {
            validation.set_issuer(&[iss]);
        }
        // 硬锁 ES256 非对称签名，不从 OIDC Discovery 动态填充算法列表
        // （防 alg 混淆攻击：若 discovery 被篡改声明 HS256 可降级为对称签名）
        validation.algorithms = vec![jsonwebtoken::Algorithm::ES256];

        // 预解析 refresh_endpoint 路径（不写缓存，仅返回原始路径）
        let refresh_endpoint = metadata_val
            .get("refresh_endpoint")
            .and_then(|v| v.as_str())
            .and_then(|ep| {
                Self::resolve_jwks_url(scheme, upstream, ep)
                    .map_err(|e| warn!("OIDC refresh_endpoint URL 解析失败，跳过: {}", e))
                    .ok()
            })
            .map(Arc::from);

        // 解析 Gateway OAuth callback 拦截路径（来自 OIDC Discovery 自定义字段 oauth_callback_path）
        let callback_path = metadata_val
            .get("oauth_callback_path")
            .and_then(|v| v.as_str())
            .filter(|p| p.starts_with('/'))
            .map(Arc::<str>::from);

        Ok(OidcDiscovery {
            validation: Arc::new(validation),
            refresh_endpoint,
            jwks_uri: jwks_uri.to_string(),
            callback_path,
        })
    }

    /// 原子写入 OIDC 元数据 + JWKS 公钥，一次 store 完成所有变更
    fn apply_discovery(
        &self,
        discovery: OidcDiscovery,
        new_keys: HashMap<String, DecodingKey>,
    ) -> Result<usize, JwksError> {
        if new_keys.is_empty() {
            return Err(JwksError::EmptyKeys);
        }
        let count = new_keys.len();
        self.inner.store(Arc::new(OidcMetadata {
            keys: new_keys,
            validation: discovery.validation,
            refresh_endpoint: discovery.refresh_endpoint,
            callback_path: discovery.callback_path,
        }));
        Ok(count)
    }

    /// 从 OIDC 元数据中解析出可达的 JWKS 端点 URL
    ///
    /// # 参数
    /// * `scheme` - 内部上游请求协议（http/https）
    /// * `upstream` - Portal 上游地址（如 127.0.0.1:4100）
    /// * `jwks_uri` - OIDC 元数据中包含的原始 jwks_uri 字段
    pub(crate) fn resolve_jwks_url(
        scheme: &str,
        upstream: &str,
        jwks_uri: &str,
    ) -> Result<String, JwksError> {
        let parsed =
            reqwest::Url::parse(jwks_uri).map_err(|e| JwksError::InvalidJwksUri(e.to_string()))?;

        let path = parsed.path();
        if let Some(query) = parsed.query() {
            Ok(format!("{}://{}{}?{}", scheme, upstream, path, query))
        } else {
            Ok(format!("{}://{}{}", scheme, upstream, path))
        }
    }

    /// 通过 OIDC Discovery 自动发现并拉取 JWKS 公钥，原子更新 OIDC 元数据缓存
    ///
    /// 先拉取 OIDC 元数据和 JWKS 公钥，全部成功后才一次性原子 store 写入，
    /// 避免元数据已更新而公钥拉取失败导致的不一致状态。
    ///
    /// # 参数
    /// * `upstream` - Portal 上游地址（如 127.0.0.1:4100）
    /// * `scheme` - 内部上游请求协议（http/https），启动期显式注入
    pub async fn refresh(&self, upstream: &str, scheme: &str) -> Result<(), JwksError> {
        // 1. 拉取 OIDC Discovery 元数据（不写缓存）
        let discovery = self.fetch_oidc_metadata(upstream, scheme).await?;

        // 2. 从元数据中解析可达的 JWKS URL
        let jwks_url = Self::resolve_jwks_url(scheme, upstream, &discovery.jwks_uri)?;
        info!("🔑 使用 JWKS 端点: {}", jwks_url);

        // 3. 拉取并解析 JWKS 公钥集
        let resp = HTTP_CLIENT.get(&jwks_url).send().await?;
        let jwk_set: JwkSet = resp.json().await?;
        let mut new_keys = HashMap::new();
        for jwk in &jwk_set.keys {
            if let (Some(kid), Ok(key)) = (&jwk.common.key_id, DecodingKey::from_jwk(jwk)) {
                new_keys.insert(kid.clone(), key);
            }
        }

        // 4. 原子写入：元数据 + 公钥一并提交
        let count = self.apply_discovery(discovery, new_keys)?;

        crate::metrics::record_jwks_refresh_success();
        info!(
            "✅ JWKS 公钥缓存刷新成功，加载了 {} 个 Key (via OIDC Discovery)",
            count
        );
        Ok(())
    }

    /// 用于测试和基准测试的公钥注入方法。
    ///
    /// 仅在测试/benchmark 中使用，生产代码切勿调用。
    /// 写路径为 load_full → clone → mutate → store（冷路径，拷贝无碍）。
    #[doc(hidden)]
    pub fn insert_key_for_test(&self, kid: String, key: DecodingKey) {
        let mut meta = (*self.inner.load_full()).clone();
        meta.keys.insert(kid, key);
        self.inner.store(Arc::new(meta));
    }

    /// 用于测试和基准测试的元数据设置方法。
    ///
    /// 仅在测试/benchmark 中使用，生产代码切勿调用。
    #[doc(hidden)]
    pub fn set_metadata_for_test(&self, issuer: &str, supported_algs: &[&str]) {
        let mut meta = (*self.inner.load_full()).clone();
        let mut validation = base_validation();
        validation.set_issuer(&[issuer]);
        validation.algorithms = supported_algs
            .iter()
            .filter_map(|&alg| Self::parse_algorithm(alg))
            .collect();
        meta.validation = Arc::new(validation);
        meta.refresh_endpoint = None;
        meta.callback_path = None;
        self.inner.store(Arc::new(meta));
    }
}

// ── JWKS 后台定时刷新服务 ──

/// 缓存为空时的重试间隔（快速初始化）
const JWKS_INIT_RETRY_SECS: u64 = 10;

/// 渐进式退避延迟表（秒）：索引为连续失败次数 - 1
const JWKS_BACKOFF_SECS: &[u64] = &[30, 60, 120, 300];

#[derive(Debug)]
pub struct JwksRefreshService {
    jwks_cache: Arc<JwksCache>,
    /// Portal 上游地址列表（Arc 共享，与 AuthService 复用同一实例）
    upstreams: Arc<Upstreams>,
    /// 内部上游请求协议（http/https），启动期由 main.rs 显式注入
    upstream_scheme: String,
    /// 连续失败计数器（AtomicU64 支持内部可变性，用于 start(&self) 中的渐进退避）
    consecutive_failures: std::sync::atomic::AtomicU64,
    /// 刷新成功后的标准间隔（秒），可通过配置覆盖
    refresh_interval_secs: u64,
}

impl JwksRefreshService {
    pub fn new(
        jwks_cache: Arc<JwksCache>,
        upstreams: Arc<Upstreams>,
        upstream_scheme: String,
        refresh_interval_secs: u64,
    ) -> Self {
        Self {
            jwks_cache,
            upstreams,
            upstream_scheme,
            consecutive_failures: std::sync::atomic::AtomicU64::new(0),
            refresh_interval_secs,
        }
    }

    /// 计算当前应等待的退避延迟（秒）。
    ///
    /// - 刷新成功 → 重置计数器，返回标准间隔
    /// - 刷新失败 + 缓存为空 → 快速重试（10s，不计入连续失败）
    /// - 刷新失败 + 缓存非空 → 渐进式退避（30s → 60s → 120s → 300s max）
    fn backoff_delay(&self, success: bool) -> u64 {
        if success {
            self.consecutive_failures
                .store(0, std::sync::atomic::Ordering::Relaxed);
            return self.refresh_interval_secs;
        }
        if self.jwks_cache.is_empty() {
            // 缓存为空：快速重试，不计入渐进退避
            return JWKS_INIT_RETRY_SECS;
        }
        let failures = self
            .consecutive_failures
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            + 1;
        let idx = (failures as usize)
            .saturating_sub(1)
            .min(JWKS_BACKOFF_SECS.len() - 1);
        JWKS_BACKOFF_SECS[idx]
    }

    /// 遍历所有上游地址，逐个尝试 OIDC Discovery，任一成功即返回
    async fn try_refresh_from_any(&self) -> Result<(), JwksError> {
        if self.upstreams.is_empty() {
            warn!("⚠️ 未配置任何上游地址，无法执行 OIDC Discovery");
            return Err(JwksError::NoUpstreams);
        }

        let mut last_err = None;
        for upstream in self.upstreams.iter() {
            info!("🔍 通过上游 {} 尝试 OIDC Discovery...", upstream);
            match self
                .jwks_cache
                .refresh(upstream, &self.upstream_scheme)
                .await
            {
                Ok(()) => return Ok(()),
                Err(e) => {
                    warn!("  ✗ {} 不可达: {}", upstream, e);
                    last_err = Some(e);
                }
            }
        }
        Err(last_err.unwrap_or(JwksError::NoUpstreams))
    }
}

#[async_trait::async_trait]
impl BackgroundService for JwksRefreshService {
    async fn start(&self, mut shutdown: ShutdownWatch) {
        // 阻塞首次刷新：确保 JWKS 缓存就绪后才启动主事件循环。
        // 避免 Gateway 在首次 Discovery 完成前就开始接受流量，
        // 导致所有 JWT 验证因 UnknownKid 而失败。
        info!("🔍 执行首次 JWKS 刷新，等待缓存就绪...");
        loop {
            match self.try_refresh_from_any().await {
                Ok(()) => {
                    info!("✅ 首次 JWKS 缓存刷新成功，开始接受流量");
                    break;
                }
                Err(e) => {
                    warn!(
                        "⏳ 首次 JWKS 刷新失败: {}，{} 秒后重试...",
                        e, JWKS_INIT_RETRY_SECS
                    );
                    tokio::select! {
                        _ = shutdown.changed() => {
                            info!("JWKS 刷新服务在首次刷新期间收到退出信号");
                            return;
                        }
                        _ = tokio::time::sleep(Duration::from_secs(JWKS_INIT_RETRY_SECS)) => {}
                    }
                }
            }
        }

        // 主事件循环：定时后台刷新
        loop {
            let result = self.try_refresh_from_any().await;
            let delay_secs = match &result {
                Ok(()) => {
                    info!("✅ JWKS 公钥缓存定时刷新成功");
                    crate::metrics::log_snapshot();
                    self.backoff_delay(true)
                }
                Err(e) => {
                    tracing::error!("❌ 所有上游节点的 JWKS 公钥刷新均失败: {}", e);
                    let delay = self.backoff_delay(false);
                    let failures = self
                        .consecutive_failures
                        .load(std::sync::atomic::Ordering::Relaxed);
                    warn!(
                        "⚠️ 网关将在 {} 秒后重试拉取 JWKS（连续失败 {} 次）...",
                        delay, failures
                    );
                    delay
                }
            };

            tokio::select! {
                _ = shutdown.changed() => {
                    info!("JWKS 刷新服务收到退出信号...");
                    break;
                }
                _ = tokio::time::sleep(Duration::from_secs(delay_secs)) => {}
            }
        }
    }
}

/// 单元测试模块，外置于 `jwks/tests.rs`
#[cfg(test)]
mod tests;
