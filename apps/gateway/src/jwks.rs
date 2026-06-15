use jsonwebtoken::DecodingKey;
use log::info;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// JWKS 公钥缓存结构体
/// 使用 RwLock 实现：多个请求并发读，刷新时独占写
pub struct JwksCache {
    pub keys: RwLock<HashMap<String, DecodingKey>>,
}

impl JwksCache {
    /// 创建空的 JWKS 缓存实例
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            keys: RwLock::new(HashMap::new()),
        })
    }

    /// 从 Portal JWKS 端点拉取所有公钥并更新缓存，支持按 kid 匹配
    ///
    /// # 参数
    /// * `jwks_url` - Portal 的 JWKS 端点 URL（如 https://portal.xxx.com/.well-known/jwks）
    pub async fn refresh(
        &self,
        jwks_url: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let resp = reqwest::get(jwks_url).await?;
        let jwks: serde_json::Value = resp.json().await?;

        let mut new_keys = HashMap::new();
        if let Some(keys) = jwks["keys"].as_array() {
            for key_obj in keys {
                if let Some(kid) = key_obj["kid"].as_str() {
                    let key = DecodingKey::from_jwk(&serde_json::from_value(key_obj.clone())?)?;
                    new_keys.insert(kid.to_string(), key);
                }
            }
        }

        if new_keys.is_empty() {
            return Err("JWKS 响应中未找到有效公钥".into());
        }

        *self.keys.write().await = new_keys;
        info!(
            "JWKS 公钥缓存刷新成功，加载了 {} 个 Key，来源: {}",
            self.keys.read().await.len(),
            jwks_url
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

        let mut new_keys = HashMap::new();
        if let Some(keys) = jwks_json["keys"].as_array() {
            for key_obj in keys {
                if let Some(kid) = key_obj["kid"].as_str() {
                    let key =
                        DecodingKey::from_jwk(&serde_json::from_value(key_obj.clone()).unwrap())
                            .unwrap();
                    new_keys.insert(kid.to_string(), key);
                }
            }
        }

        assert_eq!(new_keys.len(), 2);
        assert!(new_keys.contains_key("key-1"));
        assert!(new_keys.contains_key("key-2"));
        assert!(!new_keys.contains_key("key-3"));
    }
}
