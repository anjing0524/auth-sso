use jsonwebtoken::Algorithm;
use jsonwebtoken::DecodingKey;
use jsonwebtoken::Validation;
use jsonwebtoken::jwk::JwkSet;
use pingora_core::server::ShutdownWatch;
use pingora_core::services::background::BackgroundService;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tracing::{error, info, warn};

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
    /// 读写锁中毒故障
    #[error("JWKS 读写锁中毒失效")]
    LockPoisoned,
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
}

/// OIDC 元数据结构体，将公钥映射与 OIDC 校验配置统一存放，提供极高的并发原子读取性能
#[derive(Clone)]
struct OidcMetadata {
    /// kid -> 公钥映射表
    keys: HashMap<String, DecodingKey>,
    /// 预构建的 JWT 校验配置（Arc 共享引用，热路径仅原子引用计数递增，零拷贝）
    validation: Arc<Validation>,
    /// Token 刷新接口端点 URL (已解析为完整内网 URL)
    refresh_endpoint: Option<Arc<str>>,
}

impl Default for OidcMetadata {
    fn default() -> Self {
        let mut validation = Validation::new(Algorithm::ES256);
        validation.validate_aud = false;
        validation.validate_exp = false;
        Self {
            keys: HashMap::new(),
            validation: Arc::new(validation),
            refresh_endpoint: None,
        }
    }
}

/// JWKS 公钥缓存结构体
///
/// 采用单读写锁（RwLock）设计，内部字段使用 Arc 包装。
/// 高并发请求验签仅需一次加锁，并以引用计数形式无拷贝获取所需配置，彻底规避热路径上的动态内存分配。
pub struct JwksCache {
    inner: std::sync::RwLock<OidcMetadata>,
}

impl Default for JwksCache {
    fn default() -> Self {
        Self::new()
    }
}

impl JwksCache {
    /// 创建空的 JWKS 缓存实例
    pub fn new() -> Self {
        Self {
            inner: std::sync::RwLock::new(OidcMetadata::default()),
        }
    }

    /// 获取特定 kid 对应的公钥（同步读取）
    pub fn get_key(&self, kid: &str) -> Option<DecodingKey> {
        match self.inner.read() {
            Ok(guard) => guard.keys.get(kid).cloned(),
            Err(e) => {
                error!("JWKS 读写锁中毒 (get_key): {:?}", e);
                None
            }
        }
    }

    /// 判断当前公钥缓存是否为空
    pub(crate) fn is_empty(&self) -> bool {
        self.inner
            .read()
            .map(|guard| guard.keys.is_empty())
            .unwrap_or_else(|e| {
                error!("JWKS 读写锁中毒 (is_empty): {:?}", e);
                true
            })
    }

    /// 获取预构建的 OIDC 校验配置（Arc 共享引用，热路径原子引用计数递增，零拷贝）
    pub fn get_validation(&self) -> Arc<Validation> {
        self.inner
            .read()
            .ok()
            .map(|guard| Arc::clone(&guard.validation))
            .unwrap_or_else(|| {
                error!(
                    "JWKS 读写锁中毒 (get_validation)，回退到默认 Validation — JWT 验签可能异常"
                );
                let mut validation = Validation::new(Algorithm::ES256);
                validation.validate_aud = false;
                validation.validate_exp = false;
                Arc::new(validation)
            })
    }

    /// 获取缓存的 Token 刷新接口端点 URL (只读共享指针)
    pub fn get_refresh_endpoint(&self) -> Option<Arc<str>> {
        match self.inner.read() {
            Ok(guard) => guard.refresh_endpoint.clone(),
            Err(e) => {
                error!("JWKS 读写锁中毒 (get_refresh_endpoint): {:?}", e);
                None
            }
        }
    }

    /// 将单个 OIDC 字符串算法名转为 `Algorithm`；不支持的算法记录告警并返回 None
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
                warn!("⚠️  OIDC Discovery 返回不支持的签名算法: {}", alg);
                None
            }
        }
    }

    /// 拉取 OIDC Discovery 元数据并解析，不写入缓存（纯读取 + 解析）
    ///
    /// 返回解析后的 validation、refresh_endpoint 和 jwks_uri，
    /// 待 JWKS 公钥也拉取成功后由 `apply_discovery` 一并原子写入。
    async fn fetch_oidc_metadata(&self, upstream: &str) -> Result<OidcDiscovery, JwksError> {
        let discovery_url = format!("http://{}/.well-known/openid-configuration", upstream);
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

        // 预解析 validation（不写缓存，仅返回）
        let mut validation = Validation::new(Algorithm::ES256);
        validation.validate_aud = false;
        validation.validate_exp = false;
        if let Some(iss) = issuer {
            validation.set_issuer(&[iss]);
        }
        if let Some(arr) = signing_algs_val.and_then(|v| v.as_array()) {
            validation.algorithms = arr
                .iter()
                .filter_map(|v| v.as_str())
                .filter_map(Self::parse_algorithm)
                .collect();
        }

        // 预解析 refresh_endpoint 路径（不写缓存，仅返回原始路径）
        let refresh_endpoint = metadata_val
            .get("refresh_endpoint")
            .and_then(|v| v.as_str())
            .and_then(|ep| {
                Self::resolve_jwks_url(upstream, ep)
                    .map_err(|e| warn!("OIDC refresh_endpoint URL 解析失败，跳过: {}", e))
                    .ok()
            })
            .map(Arc::from);

        Ok(OidcDiscovery {
            validation: Arc::new(validation),
            refresh_endpoint,
            jwks_uri: jwks_uri.to_string(),
        })
    }

    /// 原子写入 OIDC 元数据 + JWKS 公钥，一次写锁完成所有变更
    fn apply_discovery(
        &self,
        discovery: OidcDiscovery,
        new_keys: HashMap<String, DecodingKey>,
    ) -> Result<usize, JwksError> {
        if new_keys.is_empty() {
            return Err(JwksError::EmptyKeys);
        }
        let count = new_keys.len();
        let mut guard = self.inner.write().map_err(|_| JwksError::LockPoisoned)?;
        guard.keys = new_keys;
        guard.validation = discovery.validation;
        guard.refresh_endpoint = discovery.refresh_endpoint;
        Ok(count)
    }

    /// 从 OIDC 元数据中解析出可达的 JWKS 端点 URL
    ///
    /// # 参数
    /// * `upstream` - Portal 上游地址（如 127.0.0.1:4100）
    /// * `jwks_uri` - OIDC 元数据中包含的原始 jwks_uri 字段
    pub(crate) fn resolve_jwks_url(upstream: &str, jwks_uri: &str) -> Result<String, JwksError> {
        let parsed =
            reqwest::Url::parse(jwks_uri).map_err(|e| JwksError::InvalidJwksUri(e.to_string()))?;

        let path = parsed.path();
        if let Some(query) = parsed.query() {
            Ok(format!("http://{}{}?{}", upstream, path, query))
        } else {
            Ok(format!("http://{}{}", upstream, path))
        }
    }

    /// 通过 OIDC Discovery 自动发现并拉取 JWKS 公钥，原子更新 OIDC 元数据缓存
    ///
    /// 先拉取 OIDC 元数据和 JWKS 公钥，全部成功后才一次性写锁写入，
    /// 避免元数据已更新而公钥拉取失败导致的不一致状态。
    ///
    /// # 参数
    /// * `upstream` - Portal 上游地址（如 127.0.0.1:4100）
    pub async fn refresh(&self, upstream: &str) -> Result<(), JwksError> {
        // 1. 拉取 OIDC Discovery 元数据（不写缓存）
        let discovery = self.fetch_oidc_metadata(upstream).await?;

        // 2. 从元数据中解析可达的 JWKS URL
        let jwks_url = Self::resolve_jwks_url(upstream, &discovery.jwks_uri)?;
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

        info!(
            "✅ JWKS 公钥缓存刷新成功，加载了 {} 个 Key (via OIDC Discovery)",
            count
        );
        Ok(())
    }

    #[cfg(test)]
    pub fn insert_key_for_test(&self, kid: String, key: DecodingKey) {
        let mut guard = self.inner.write().unwrap();
        guard.keys.insert(kid, key);
    }

    #[cfg(test)]
    pub fn set_metadata_for_test(&self, issuer: &str, supported_algs: &[&str]) {
        let mut guard = self.inner.write().unwrap();
        let mut validation = Validation::new(Algorithm::ES256);
        validation.validate_aud = false;
        validation.validate_exp = false;
        validation.set_issuer(&[issuer]);
        validation.algorithms = supported_algs
            .iter()
            .filter_map(|&alg| Self::parse_algorithm(alg))
            .collect();
        guard.validation = Arc::new(validation);
        guard.refresh_endpoint = None;
    }
}

// ── JWKS 后台定时刷新服务 ──
pub struct JwksRefreshService {
    jwks_cache: Arc<JwksCache>,
    /// Portal 上游地址列表，OIDC Discovery 逐个尝试直到成功
    upstreams: Vec<String>,
}

impl JwksRefreshService {
    pub fn new(jwks_cache: Arc<JwksCache>, upstreams: Vec<String>) -> Self {
        Self {
            jwks_cache,
            upstreams,
        }
    }

    /// 遍历所有上游地址，逐个尝试 OIDC Discovery，任一成功即返回
    async fn try_refresh_from_any(&self) -> Result<(), JwksError> {
        if self.upstreams.is_empty() {
            warn!("⚠️ 未配置任何上游地址，无法执行 OIDC Discovery");
            return Err(JwksError::NoUpstreams);
        }

        let mut last_err = None;
        for upstream in &self.upstreams {
            info!("🔍 通过上游 {} 尝试 OIDC Discovery...", upstream);
            match self.jwks_cache.refresh(upstream).await {
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
        loop {
            // 逐个尝试所有 upstream 直到 OIDC Discovery + JWKS 拉取成功
            let delay_secs = match self.try_refresh_from_any().await {
                Ok(()) => {
                    info!("✅ JWKS 公钥缓存定时刷新成功");
                    300
                }
                Err(e) => {
                    tracing::error!("❌ 所有上游节点的 JWKS 公钥刷新均失败: {}", e);
                    let retry_delay = if self.jwks_cache.is_empty() { 10 } else { 300 };
                    warn!("⚠️ 网关将在 {} 秒后重试拉取 JWKS...", retry_delay);
                    retry_delay
                }
            };

            // 等待下一轮，或收到关停信号即退出
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
