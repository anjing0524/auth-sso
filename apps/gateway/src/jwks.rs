use arc_swap::ArcSwap;
use jsonwebtoken::Algorithm;
use jsonwebtoken::DecodingKey;
use jsonwebtoken::Validation;
use jsonwebtoken::jwk::JwkSet;
use pingora_core::server::ShutdownWatch;
use pingora_core::services::background::BackgroundService;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;
use tokio::sync::Notify;
use tracing::{info, warn};

use crate::config::Upstreams;
use crate::http::HTTP_CLIENT;

/// 公钥宽限期（秒）：刷新结果与新集合合并时，不在新集合中的旧 key 在此窗口内保留。
/// 防止上游瞬时返回残缺 JWKS（如轮换维护窗口）把仍在使用的旧 kid 顶掉，
/// 一次上游抖动放大为全站验签失败。
/// 自定义 Discovery 扩展字段名（RFC 8414 §2 命名空间前缀）。
/// 每个数组含新名与旧名，`custom_field` 按顺序探测——仅为部署错序容忍。
pub(crate) const CUSTOM_FIELD_REFRESH_ENDPOINT: &[&str] =
    &["com_authsso_refresh_endpoint", "refresh_endpoint"];
pub(crate) const CUSTOM_FIELD_CALLBACK_PATH: &[&str] =
    &["com_authsso_callback_path", "oauth_callback_path"];

/// 读取自定义扩展字段：优先带命名空间的新名，回退旧名。
///
/// 存在两个名字的唯一理由是**部署错序容忍**（RFC 8414 §2 要求扩展字段带
/// 命名空间，而旧名没有）。新名落地并确认线上无旧值后，旧名分支应删除。
fn custom_field<'a>(
    metadata: &'a serde_json::Value,
    names: &[&str],
) -> Option<&'a serde_json::Value> {
    names.iter().find_map(|n| metadata.get(*n))
}

pub(crate) const JWKS_KEY_GRACE_SECS: u64 = 24 * 3600;

/// UnknownKid 触发按需刷新的最小间隔（秒）：单飞节流，
/// 防止伪造 token 风暴借"每个坏 token 触发一次拉取"打爆 JWKS 端点。
pub(crate) const JWKS_ON_DEMAND_MIN_INTERVAL_SECS: u64 = 30;

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
    /// OIDC Discovery 端点返回的 issuer 缺失；不得降级为无 issuer 验证
    #[error("OIDC Discovery 响应中未包含有效的 issuer")]
    MissingIssuer,
    /// jwks_uri 路径解析失败
    #[error("无法从 jwks_uri 中解析出 JWKS 路径: {0}")]
    InvalidJwksUri(String),
    /// 系统时钟不可用，无法执行宽限期判定
    #[error("系统时钟不可用")]
    ClockError,
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
/// jsonwebtoken 的内置 exp 校验；aud 由 [`JwksCache::fetch_oidc_metadata`]
/// 注入网关自身 client_id 后开启（RFC 8725 §3.9 / ADR-013）。issuer 与算法
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
    /// kid -> 公钥条目映射（条目携带 cached_at，供轮换宽限期淘汰）
    pub(crate) keys: HashMap<String, JwksKeyEntry>,
    /// 预构建的 JWT 校验配置（Arc 共享引用，热路径仅原子引用计数递增，零拷贝）
    pub(crate) validation: Arc<Validation>,
    /// Token 刷新接口端点 URL (已解析为完整内网 URL)
    pub(crate) refresh_endpoint: Option<Arc<str>>,
    /// Gateway 拦截 OAuth callback 的路径（来自 OIDC Discovery `com_authsso_callback_path` 字段）
    pub(crate) callback_path: Option<Arc<str>>,
}

/// 单个公钥缓存条目
#[derive(Clone)]
pub(crate) struct JwksKeyEntry {
    /// 公钥，以 `Arc` 持有：`key()` 每次命中只做一次引用计数递增而非拷贝
    /// `DecodingKey`（其内部为 `Vec<u8>`，克隆是堆分配）。这是让 `key()` 能成为
    /// 宽限期判定**唯一真相源**的前提——否则生产热路径会为避免拷贝而绕过它。
    pub(crate) key: Arc<DecodingKey>,
    /// 首次写入时的 Unix 秒 — 宽限期淘汰依据
    pub(crate) cached_at: u64,
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
    /// UnknownKid 触发的按需刷新信号（后台服务循环监听）
    refresh_notify: Notify,
    /// 上一次按需刷新触发时间（Unix 秒）— 单飞节流依据
    last_refresh_request: AtomicI64,
    /// JWT 验签预期 aud（RFC 8725 §3.9 / ADR-013）：恒为网关自身 OAuth client_id，
    /// 由 main.rs 从 `gateway.oauth.client_id` 注入，校验常开无配置开关
    jwt_audience: Arc<str>,
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

/// 合并新旧公钥：新 keys 全量收录（fresh cached_at）；不在新集合中的旧 key
/// 保留至宽限期结束。上游瞬时返回残缺 JWKS 时，仍在使用的旧 kid 不会被顶掉。
fn merge_keys(
    old: &HashMap<String, JwksKeyEntry>,
    new: HashMap<String, DecodingKey>,
    now: u64,
    grace_secs: u64,
) -> HashMap<String, JwksKeyEntry> {
    let mut merged: HashMap<String, JwksKeyEntry> = new
        .into_iter()
        .map(|(kid, key)| {
            (
                kid,
                JwksKeyEntry {
                    key: Arc::new(key),
                    cached_at: now,
                },
            )
        })
        .collect();
    for (kid, entry) in old {
        if merged.contains_key(kid) {
            continue;
        }
        if now.saturating_sub(entry.cached_at) < grace_secs {
            merged.insert(kid.clone(), entry.clone());
        }
    }
    merged
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
        // 默认受众与 GatewayConfig::default().oauth.client_id 一致；
        // 生产路径由 main.rs 以配置值经 [`Self::with_audience`] 注入
        Self::with_audience("portal".to_string())
    }

    /// 创建带预期 aud 的缓存实例（RFC 8725 §3.9 / ADR-013 决策 2）。
    ///
    /// audience 必填（网关自身 OAuth client_id）：aud 语义定案为"签发对象
    /// client_id"后，预期受众与自身 client 身份是同一事实，无需独立配置面，
    /// 验签恒校验 JWT `aud` claim 与之相等。
    pub fn with_audience(jwt_audience: String) -> Self {
        Self {
            inner: ArcSwap::from_pointee(OidcMetadata::default()),
            refresh_notify: Notify::new(),
            last_refresh_request: AtomicI64::new(0),
            jwt_audience: Arc::from(jwt_audience),
        }
    }

    /// 热路径快照：一次 wait-free load 同时获得 keys + validation，零锁零拷贝
    pub(crate) fn snapshot(&self) -> Arc<OidcMetadata> {
        self.inner.load_full()
    }

    /// 获取特定 kid 对应的公钥（同步读取；宽限期外的条目视为不存在）
    ///
    /// # Examples
    ///
    /// ```
    /// # use gateway::jwks::JwksCache;
    /// let cache = JwksCache::new();
    /// assert!(cache.key("nonexistent").is_none());
    /// ```
    pub fn key(&self, kid: &str) -> Option<Arc<DecodingKey>> {
        self.inner.load().keys.get(kid).and_then(|entry| {
            let now = crate::http::unix_secs().unwrap_or(entry.cached_at);
            // 宽限期外的条目视为不存在（上游轮换维护窗口的残缺响应防护）。
            // 这是该判定的**唯一出处**——verify.rs 与基准均经由本函数，
            // 避免同一规则在两个地方各自维护（曾各写一份，见 ADR-021）。
            (now.saturating_sub(entry.cached_at) < JWKS_KEY_GRACE_SECS)
                .then(|| Arc::clone(&entry.key))
        })
    }

    /// UnknownKid 触发的按需刷新请求（单飞 + 最小间隔节流）。
    ///
    /// 返回 true 表示本次调用赢得触发权并已唤醒后台刷新循环；
    /// 间隔内的重复调用直接返回 false，防止伪造 token 风暴借
    /// "每个坏 token 触发一次拉取" 打爆 JWKS 端点。
    pub fn request_refresh_if_due(&self, min_interval_secs: u64) -> bool {
        let now = crate::http::unix_secs().unwrap_or(0) as i64;
        let last = self.last_refresh_request.load(Ordering::Relaxed);
        if now.saturating_sub(last) < min_interval_secs as i64 {
            return false;
        }
        if self
            .last_refresh_request
            .compare_exchange(last, now, Ordering::Relaxed, Ordering::Relaxed)
            .is_err()
        {
            return false;
        }
        self.refresh_notify.notify_one();
        true
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
    /// 中以自定义字段 `com_authsso_callback_path` 声明此值。
    pub fn callback_path_or_default(&self) -> Arc<str> {
        self.inner
            .load()
            .callback_path
            .clone()
            .unwrap_or_else(|| Arc::from("/api/auth/callback"))
        // ↑ 兜底值与 Portal Discovery `com_authsso_callback_path` 声明值
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

        let issuer = metadata_val
            .get("issuer")
            .and_then(|v| v.as_str())
            .filter(|issuer| !issuer.is_empty())
            .ok_or(JwksError::MissingIssuer)?;

        let signing_algs_val = metadata_val.get("id_token_signing_alg_values_supported");
        info!(
            "📋 OIDC 元数据已获取: issuer={:?}, jwks_uri={:?}, signing_algs={:?}",
            issuer, jwks_uri, signing_algs_val
        );

        // 预解析 validation（不写缓存，仅返回）：基线配置 + issuer + ES256 硬锁
        let mut validation = base_validation();
        validation.set_issuer(&[issuer]);
        // 硬锁 ES256 非对称签名，不从 OIDC Discovery 动态填充算法列表
        // （防 alg 混淆攻击：若 discovery 被篡改声明 HS256 可降级为对称签名）
        validation.algorithms = vec![jsonwebtoken::Algorithm::ES256];
        // aud 校验恒开（RFC 8725 §3.9 / ADR-013）：预期受众 = 网关自身 OAuth client_id，
        // 拒绝为其他 client 签发的 AT 重放到本网关（跨 client token 替代防线）
        validation.set_audience(&[self.jwt_audience.as_ref()]);
        validation.validate_aud = true;

        // 预解析 refresh_endpoint 路径（不写缓存，仅返回原始路径）。
        // RFC 8414 §2：自定义扩展字段带命名空间；容忍旧字段名以支持 Portal/Gateway
        // 部署错序（两个方向都不得因此断掉续签）。
        let refresh_endpoint = custom_field(&metadata_val, CUSTOM_FIELD_REFRESH_ENDPOINT)
            .and_then(|v| v.as_str())
            .and_then(|ep| {
                Self::resolve_jwks_url(scheme, upstream, ep)
                    .map_err(|e| warn!("OIDC refresh_endpoint URL 解析失败，跳过: {}", e))
                    .ok()
            })
            .map(Arc::from);

        // 解析 Gateway OAuth callback 拦截路径（同上，出自自定义扩展字段）
        let callback_path = custom_field(&metadata_val, CUSTOM_FIELD_CALLBACK_PATH)
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
    ///
    /// 新公钥全量收录；不在新集合中的旧 key 保留一个宽限期
    /// （[`merge_keys`]），消除上游残缺响应的放大效应。
    fn apply_discovery(
        &self,
        discovery: OidcDiscovery,
        new_keys: HashMap<String, DecodingKey>,
    ) -> Result<usize, JwksError> {
        if new_keys.is_empty() {
            return Err(JwksError::EmptyKeys);
        }
        let now = crate::http::unix_secs().ok_or(JwksError::ClockError)?;
        let count = new_keys.len();
        let old = self.inner.load();
        let merged = merge_keys(&old.keys, new_keys, now, JWKS_KEY_GRACE_SECS);
        self.inner.store(Arc::new(OidcMetadata {
            keys: merged,
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
        let cached_at = crate::http::unix_secs().unwrap_or(0);
        self.insert_key_with_cached_at_for_test(kid, key, cached_at);
    }

    /// 同 [`Self::insert_key_for_test`]，但可指定 `cached_at`。
    ///
    /// 存在的唯一理由：`key()` 的**查询期宽限期判定**（`now - cached_at < GRACE`）
    /// 只有在能注入"陈旧条目"时才可测。默认钩子用真实当前时间，构造不出过期条目，
    /// 于是该判定长期没有被任何测试覆盖——而这正是生产验签路径取公钥的必经之处。
    #[doc(hidden)]
    pub fn insert_key_with_cached_at_for_test(
        &self,
        kid: String,
        key: DecodingKey,
        cached_at: u64,
    ) {
        let mut meta = (*self.inner.load_full()).clone();
        meta.keys.insert(
            kid,
            JwksKeyEntry {
                key: Arc::new(key),
                cached_at,
            },
        );
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

/// 首刷失败重试上限：达到后放行就绪（降级运行），避免 Portal 不可达时网关永不启动
const JWKS_INIT_MAX_ATTEMPTS: u32 = 5;

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
    /// 覆盖默认就绪通知：**先完成首次 JWKS 刷新、再通知就绪**，配合 main.rs
    /// 对代理服务声明的 `add_dependency`，使网关在公钥缓存就绪前不接收流量
    /// （此前 start() 内的阻塞只约束本服务自身的事件循环，约束不到代理）。
    /// 首刷连续 JWKS_INIT_MAX_ATTEMPTS 次失败则放行就绪，降级为请求期
    /// 401/PKCE 循环 —— Portal 不可达时网关其他能力（ACME/跳转）仍可用。
    async fn start_with_ready_notifier(
        &self,
        mut shutdown: ShutdownWatch,
        ready_notifier: pingora_core::services::ServiceReadyNotifier,
    ) {
        info!("🔍 执行首次 JWKS 刷新，等待缓存就绪...");
        let mut attempts: u32 = 0;
        loop {
            match self.try_refresh_from_any().await {
                Ok(()) => {
                    info!("✅ 首次 JWKS 缓存刷新成功，开始接受流量");
                    break;
                }
                Err(e) => {
                    attempts += 1;
                    if attempts >= JWKS_INIT_MAX_ATTEMPTS {
                        warn!(
                            "⚠️ 首次 JWKS 刷新连续 {attempts} 次失败: {e}，放行就绪（请求将以 401/PKCE 降级直至恢复）"
                        );
                        break;
                    }
                    warn!(
                        "⏳ 首次 JWKS 刷新失败: {}，{} 秒后重试（{}/{}）...",
                        e, JWKS_INIT_RETRY_SECS, attempts, JWKS_INIT_MAX_ATTEMPTS
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
        ready_notifier.notify_ready();
        self.run_refresh_loop(shutdown).await;
    }

    async fn start(&self, shutdown: ShutdownWatch) {
        self.run_refresh_loop(shutdown).await;
    }
}

impl JwksRefreshService {
    /// 主刷新循环：定时刷新 + UnknownKid 按需刷新信号 + 退出信号三路 select。
    /// 先等待后刷新——首刷已在 start_with_ready_notifier 完成，进入循环立即再刷
    /// 会造成一秒内的重复拉取；sleep 前置后周期首刷落在 refresh_interval 之后。
    async fn run_refresh_loop(&self, mut shutdown: ShutdownWatch) {
        let mut delay_secs = self.refresh_interval_secs;
        loop {
            tokio::select! {
                _ = shutdown.changed() => {
                    info!("JWKS 刷新服务收到退出信号...");
                    break;
                }
                _ = tokio::time::sleep(Duration::from_secs(delay_secs)) => {}
                _ = self.jwks_cache.refresh_notify.notified() => {
                    info!("⚡ UnknownKid 触发按需 JWKS 刷新");
                }
            }

            let result = self.try_refresh_from_any().await;
            delay_secs = match &result {
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
        }
    }
}

/// 单元测试模块，外置于 `jwks/tests.rs`
#[cfg(test)]
mod tests;
