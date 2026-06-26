use jsonwebtoken::Algorithm;
use jsonwebtoken::DecodingKey;
use jsonwebtoken::jwk::JwkSet;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Arc, LazyLock};
use std::time::Duration;
use tracing::{error, info, warn};

/// 全局 HTTP 客户端单例（reqwest::Client 内置连接池，应全局复用而非每次创建）
pub static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .expect("Failed to initialize global HTTP client")
});

/// JWKS 获取与解析过程中的强类型错误定义
#[derive(thiserror::Error, Debug)]
pub enum JwksError {
    /// 网络请求或解析 JSON 失败
    #[error("网络或 JSON 解析错误: {0}")]
    Network(#[from] reqwest::Error),
    /// 响应中不含任何合法的公钥
    #[error("JWKS 响应中未找到任何有效且可解析的公钥")]
    EmptyKeys,
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

/// OIDC Discovery 元数据 — 从 /.well-known/openid-configuration 提取网关所需字段
#[derive(Debug, Clone, Deserialize)]
pub struct OidcMetadata {
    /// OIDC Provider 的 issuer 标识
    pub issuer: Option<String>,
    /// JWKS 公钥端点 URL
    pub jwks_uri: Option<String>,
    /// ID Token 签名算法列表
    #[serde(default)]
    pub id_token_signing_alg_values_supported: Vec<String>,
    /// Cookie-based Token 静默续签端点 URL（自定义字段，非标准 OIDC）
    #[serde(default)]
    pub refresh_endpoint: Option<String>,
}

/// JWKS 公钥缓存结构体
/// 使用 RwLock 实现：多个请求并发读，刷新时独占写。
/// 同时缓存 OIDC Discovery 元数据，用于动态签名算法选择和 issuer 交叉校验。
/// HTTP 客户端由外部注入（全局单例 LazyLock<reqwest::Client>），不内嵌于缓存中。
pub struct JwksCache {
    keys: std::sync::RwLock<HashMap<String, DecodingKey>>,
    /// OIDC Discovery 元数据缓存（启动时拉取，每次 JWKS 刷新时同步更新）
    oidc_metadata: std::sync::RwLock<Option<OidcMetadata>>,
}

impl JwksCache {
    /// 创建空的 JWKS 缓存实例（返回 Self，由调用方决定是否包装在 Arc 中）
    pub fn new() -> Self {
        Self {
            keys: std::sync::RwLock::new(HashMap::new()),
            oidc_metadata: std::sync::RwLock::new(None),
        }
    }

    /// 获取特定 kid 对应的公钥（同步读取）
    pub fn get_key(&self, kid: &str) -> Option<DecodingKey> {
        self.keys.read().ok()?.get(kid).cloned()
    }

    /// 判断当前公钥缓存是否为空
    pub fn is_empty(&self) -> bool {
        self.keys.read().map(|k| k.is_empty()).unwrap_or(true)
    }

    /// 获取缓存的 OIDC Discovery 元数据中的 issuer
    pub fn get_discovered_issuer(&self) -> Option<String> {
        self.oidc_metadata
            .read()
            .ok()?
            .as_ref()
            .and_then(|m| m.issuer.clone())
    }

    /// 从缓存的 OIDC Discovery 元数据中获取 refresh_endpoint URL
    /// 返回 None 表示元数据中未包含该字段（旧版 Portal），调用方应回退到默认路径
    pub fn get_refresh_endpoint(&self) -> Option<String> {
        self.oidc_metadata
            .read()
            .ok()?
            .as_ref()
            .and_then(|m| m.refresh_endpoint.clone())
    }

    /// 将 id_token_signing_alg_values_supported 中的字符串算法名转换为 jsonwebtoken::Algorithm
    /// 仅返回网关支持的算法（ES256/RS256/HS256 等），过滤不支持的算法
    pub fn get_supported_algorithms(&self) -> Vec<Algorithm> {
        self.oidc_metadata
            .read()
            .ok()
            .and_then(|guard| {
                guard.as_ref().map(|m| {
                    m.id_token_signing_alg_values_supported
                        .iter()
                        .filter_map(|alg| match alg.as_str() {
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
                        })
                        .collect()
                })
            })
            .unwrap_or_default()
    }

    /// 将 JWKS 公钥集写入缓存（sync 和 async 刷新路径的共享内部逻辑）
    fn store_jwks(&self, jwk_set: &JwkSet) -> Result<usize, JwksError> {
        let mut new_keys = HashMap::new();
        for jwk in &jwk_set.keys {
            if let (Some(kid), Ok(key)) = (&jwk.common.key_id, DecodingKey::from_jwk(jwk)) {
                new_keys.insert(kid.clone(), key);
            }
        }

        if new_keys.is_empty() {
            return Err(JwksError::EmptyKeys);
        }

        let count = new_keys.len();
        *self.keys.write().map_err(|_| JwksError::LockPoisoned)? = new_keys;
        Ok(count)
    }

    /// 通过 OIDC Discovery 自动发现 JWKS 端点 URL 并缓存完整 OIDC 元数据
    ///
    /// 步骤:
    /// 1. 请求 `http://{upstream}/.well-known/openid-configuration` 获取 OIDC 元数据
    /// 2. 缓存完整元数据（issuer、签名算法、各端点 URL）
    /// 3. 从元数据中提取 `jwks_uri` 的路径部分
    /// 4. 使用 upstream 作为主机地址重新构造 JWKS URL，确保网关可直接访问内网地址
    ///
    /// # 参数
    /// * `client` - 复用的 HTTP 客户端
    /// * `upstream` - Portal 上游地址（如 127.0.0.1:4100）
    async fn discover_oidc_metadata(
        &self,
        client: &reqwest::Client,
        upstream: &str,
    ) -> Result<OidcMetadata, JwksError> {
        let discovery_url = format!("http://{}/.well-known/openid-configuration", upstream);
        info!("🔍 通过 OIDC Discovery 获取元数据: {}", discovery_url);

        let resp = client.get(&discovery_url).send().await?;
        let metadata: OidcMetadata = resp.json().await?;

        // 校验必要字段
        if metadata.jwks_uri.is_none() {
            return Err(JwksError::MissingJwksUri);
        }
        if metadata.issuer.is_none() {
            warn!("⚠️  OIDC Discovery 响应中未包含 issuer 字段");
        }

        info!(
            "📋 OIDC 元数据已获取: issuer={:?}, jwks_uri={:?}, signing_algs={:?}",
            metadata.issuer, metadata.jwks_uri, metadata.id_token_signing_alg_values_supported
        );

        // 缓存 OIDC 元数据（直接赋值，不需 std::mem::replace + clone）
        *self
            .oidc_metadata
            .write()
            .map_err(|_| JwksError::LockPoisoned)? = Some(metadata.clone());

        Ok(metadata)
    }

    /// 从 OIDC 元数据中解析出可达的 JWKS 端点 URL
    ///
    /// 步骤:
    /// 1. 使用 reqwest::Url 解析 OIDC 元数据返回的 jwks_uri
    /// 2. 提取其 path 和 query 部分，重新拼接上游地址 (upstream)，
    ///    确保网关通过局域网/内网地址直接拉取公钥，避免经过外网域名绕路
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

    /// 通过 OIDC Discovery 自动发现并拉取 JWKS 公钥，同步更新 OIDC 元数据缓存
    ///
    /// # 参数
    /// * `client` - 复用的 HTTP 客户端
    /// * `upstream` - Portal 上游地址（如 127.0.0.1:4100）
    pub async fn refresh(&self, client: &reqwest::Client, upstream: &str) -> Result<(), JwksError> {
        // 1. 通过 OIDC Discovery 获取并缓存完整元数据
        let oidc_metadata = self.discover_oidc_metadata(client, upstream).await?;

        // 2. 从元数据中解析可达的 JWKS URL
        let jwks_uri = oidc_metadata
            .jwks_uri
            .as_ref()
            .ok_or(JwksError::MissingJwksUri)?;
        let jwks_url = Self::resolve_jwks_url(upstream, jwks_uri)?;
        info!("🔑 使用 JWKS 端点: {}", jwks_url);

        // 3. 拉取 JWKS 公钥集
        let resp = client.get(&jwks_url).send().await?;
        let jwk_set: JwkSet = resp.json().await?;
        let count = self.store_jwks(&jwk_set)?;

        info!(
            "✅ JWKS 公钥缓存刷新成功，加载了 {} 个 Key (via OIDC Discovery)",
            count
        );
        Ok(())
    }

    /// 启动 JWKS 后台定时刷新任务，通过 OIDC Discovery 自动发现端点。
    ///
    /// 首次拉取立即执行（非阻塞），后续每 300s 刷新一次。
    /// 缓存为空时 JWKS 验签自然失败 → Gateway 拒绝请求，直到首次拉取成功。
    /// 空缓存时拉取失败以 10s 间隔快速重试，成功后恢复 300s 正常间隔。
    ///
    /// # 参数
    /// * `self` - 自身的 Arc 智能指针
    /// * `handle` - Pingora 的 tokio 运行时句柄
    /// * `upstream` - Portal 上游地址，用于 OIDC Discovery
    pub fn start_background_refresh(
        self: Arc<Self>,
        handle: &tokio::runtime::Handle,
        upstream: String,
    ) {
        handle.spawn(async move {
            loop {
                match self.refresh(&HTTP_CLIENT, &upstream).await {
                    Ok(_) => {
                        info!("✅ JWKS 公钥缓存定时刷新成功");
                        tokio::time::sleep(std::time::Duration::from_secs(300)).await;
                    }
                    Err(e) => {
                        error!("❌ JWKS 公钥缓存定时刷新失败: {}", e);
                        let has_keys = !self.is_empty();
                        let retry_delay = if has_keys { 300 } else { 10 };
                        warn!("⚠️ 网关将在 {} 秒后重试拉取 JWKS...", retry_delay);
                        tokio::time::sleep(std::time::Duration::from_secs(retry_delay)).await;
                    }
                }
            }
        });
    }

    #[cfg(test)]
    pub fn insert_key_for_test(&self, kid: String, key: DecodingKey) {
        let mut guard = self.keys.write().unwrap();
        guard.insert(kid, key);
    }

    #[cfg(test)]
    pub fn set_metadata_for_test(&self, metadata: OidcMetadata) {
        let mut guard = self.oidc_metadata.write().unwrap();
        *guard = Some(metadata);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_jwks_url() {
        // 标准 URL
        let url =
            JwksCache::resolve_jwks_url("127.0.0.1:4100", "http://localhost:4100/api/auth/jwks")
                .unwrap();
        assert_eq!(url, "http://127.0.0.1:4100/api/auth/jwks");

        // HTTPS issuer URL
        let url =
            JwksCache::resolve_jwks_url("portal:4000", "https://sso.example.com/api/auth/jwks")
                .unwrap();
        assert_eq!(url, "http://portal:4000/api/auth/jwks");

        // 带端口号的 issuer
        let url = JwksCache::resolve_jwks_url(
            "10.0.0.1:8080",
            "https://auth.example.com:443/.well-known/jwks.json",
        )
        .unwrap();
        assert_eq!(url, "http://10.0.0.1:8080/.well-known/jwks.json");
    }

    #[test]
    fn test_oidc_metadata_deserialize() {
        let json = serde_json::json!({
            "issuer": "https://sso.example.com",
            "jwks_uri": "https://sso.example.com/api/auth/jwks",
            "id_token_signing_alg_values_supported": ["ES256", "RS256"]
        });

        let metadata: OidcMetadata = serde_json::from_value(json).unwrap();
        assert_eq!(metadata.issuer.unwrap(), "https://sso.example.com");
        assert_eq!(
            metadata.jwks_uri.unwrap(),
            "https://sso.example.com/api/auth/jwks"
        );
        assert_eq!(
            metadata.id_token_signing_alg_values_supported,
            vec!["ES256", "RS256"]
        );
    }

    #[test]
    fn test_get_supported_algorithms() {
        let cache = JwksCache::new();
        // 模拟写入 OIDC 元数据
        {
            let mut guard = cache.oidc_metadata.write().unwrap();
            *guard = Some(OidcMetadata {
                issuer: Some("https://sso.example.com".into()),
                jwks_uri: Some("https://sso.example.com/api/auth/jwks".into()),
                id_token_signing_alg_values_supported: vec![
                    "ES256".into(),
                    "RS256".into(),
                    "UNKNOWN_ALG".into(),
                ],
                refresh_endpoint: None,
            });
        }

        let algs = cache.get_supported_algorithms();
        assert_eq!(algs.len(), 2);
        assert!(algs.contains(&Algorithm::ES256));
        assert!(algs.contains(&Algorithm::RS256));
    }

    #[tokio::test]
    async fn test_jwks_parsing() {
        // 模拟一个标准的 JWKS JSON
        // 包含两个公钥（kid 分别为 key-1 和 key-2），采用 ES256 算法 (crv: P-256)
        let jwks_json = serde_json::json!({
            "keys": [
                {
                    "kty": "EC",
                    "crv": "P-256",
                    "x": "MKBCTNIcKUSDii11ySs3526iDZ8AiTo7Tu6KPAqv7D4",
                    "y": "4Etl6SRW2YiLUrN5vfvVHuhp7x8PxltmWWlbbM4IFyM",
                    "use": "sig",
                    "alg": "ES256",
                    "kid": "key-1"
                },
                {
                    "kty": "EC",
                    "crv": "P-256",
                    "x": "f83OJ3D2xF1Bg8vub9tM1gdwMAM8nt51AKWXx2LKV3A",
                    "y": "x_da6tqh6AD1cK29KXYq7t5G29Cg1P28K39A2XYq7t8",
                    "use": "sig",
                    "alg": "ES256",
                    "kid": "key-2"
                }
            ]
        });

        let jwk_set: JwkSet = serde_json::from_value(jwks_json).unwrap();
        let mut new_keys = HashMap::new();
        for jwk in jwk_set.keys {
            if let (Some(kid), Ok(key)) = (&jwk.common.key_id, DecodingKey::from_jwk(&jwk)) {
                new_keys.insert(kid.clone(), key);
            }
        }

        assert_eq!(new_keys.len(), 2);
        assert!(new_keys.contains_key("key-1"));
        assert!(new_keys.contains_key("key-2"));
        assert!(!new_keys.contains_key("key-3"));
    }
}
