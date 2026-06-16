use jsonwebtoken::DecodingKey;
use jsonwebtoken::jwk::JwkSet;
use log::info;
use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;

/// JWKS 获取与解析过程中的强类型错误定义
#[derive(Debug)]
pub enum JwksError {
    /// 网络请求或解析 JSON 失败
    Network(reqwest::Error),
    /// 响应中不含任何合法的公钥
    EmptyKeys,
    /// 读写锁中毒故障
    LockPoisoned,
}

impl fmt::Display for JwksError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            JwksError::Network(e) => write!(f, "网络或 JSON 解析错误: {}", e),
            JwksError::EmptyKeys => write!(f, "JWKS 响应中未找到任何有效且可解析的公钥"),
            JwksError::LockPoisoned => write!(f, "JWKS 读写锁中毒失效"),
        }
    }
}

impl std::error::Error for JwksError {}

impl From<reqwest::Error> for JwksError {
    fn from(err: reqwest::Error) -> Self {
        JwksError::Network(err)
    }
}

/// JWKS 公钥缓存结构体
/// 使用 RwLock 实现：多个请求并发读，刷新时独占写；内置复用 HTTP 客户端以支持 Keep-Alive 连接与请求超时。
pub struct JwksCache {
    keys: std::sync::RwLock<HashMap<String, DecodingKey>>,
    pub client: reqwest::Client,
}

impl JwksCache {
    /// 创建空的 JWKS 缓存实例并初始化复用的 HTTP 客户端
    pub fn new() -> Arc<Self> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Arc::new(Self {
            keys: std::sync::RwLock::new(HashMap::new()),
            client,
        })
    }

    /// 获取特定 kid 对应的公钥（同步读取）
    pub fn get_key(&self, kid: &str) -> Option<DecodingKey> {
        self.keys.read().ok()?.get(kid).cloned()
    }

    /// 判断当前公钥缓存是否为空
    pub fn is_empty(&self) -> bool {
        self.keys.read().map(|k| k.is_empty()).unwrap_or(true)
    }

    /// 从 Portal JWKS 端点拉取所有公钥并更新缓存，支持按 kid 匹配
    ///
    /// # 参数
    /// * `jwks_url` - Portal 的 JWKS 端点 URL（如 https://portal.xxx.com/.well-known/jwks）
    pub async fn refresh(&self, jwks_url: &str) -> Result<(), JwksError> {
        // 生产优化：使用复用的 Client 发送请求，且有 5 秒超时保护，避免网络卡死导致协程挂起积压
        let resp = self.client.get(jwks_url).send().await?;

        // 拥抱 jsonwebtoken 强类型 JwkSet，杜绝动态 Value 反序列化摸索
        let jwk_set: JwkSet = resp.json().await?;

        let mut new_keys = HashMap::new();
        for jwk in jwk_set.keys {
            if let (Some(kid), Ok(key)) = (&jwk.common.key_id, DecodingKey::from_jwk(&jwk)) {
                new_keys.insert(kid.clone(), key);
            }
        }

        if new_keys.is_empty() {
            return Err(JwksError::EmptyKeys);
        }

        // 记录长度以在写锁释放前输出日志，避免在释放写锁后重新读锁，规避竞争
        let loaded_count = new_keys.len();
        {
            let mut keys_guard = self.keys.write().map_err(|_| JwksError::LockPoisoned)?;
            *keys_guard = new_keys;
        }

        info!(
            "JWKS 公钥缓存刷新成功，加载了 {} 个 Key，来源: {}",
            loaded_count, jwks_url
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
