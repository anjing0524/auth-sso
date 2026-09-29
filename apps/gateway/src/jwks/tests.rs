use super::*;

#[test]
fn test_resolve_jwks_url() {
    // 标准 URL
    let url = JwksCache::resolve_jwks_url(
        "http",
        "127.0.0.1:4100",
        "http://localhost:4100/api/auth/jwks",
    )
    .unwrap();
    assert_eq!(url, "http://127.0.0.1:4100/api/auth/jwks");

    // HTTPS issuer URL
    let url = JwksCache::resolve_jwks_url(
        "http",
        "portal:4000",
        "https://sso.example.com/api/auth/jwks",
    )
    .unwrap();
    assert_eq!(url, "http://portal:4000/api/auth/jwks");

    // 带端口号 of issuer
    let url = JwksCache::resolve_jwks_url(
        "http",
        "10.0.0.1:8080",
        "https://auth.example.com:443/.well-known/jwks.json",
    )
    .unwrap();
    assert_eq!(url, "http://10.0.0.1:8080/.well-known/jwks.json");

    // 显式注入 https scheme（内网 mTLS 场景）
    let url = JwksCache::resolve_jwks_url(
        "https",
        "portal:4000",
        "https://sso.example.com/api/auth/jwks",
    )
    .unwrap();
    assert_eq!(url, "https://portal:4000/api/auth/jwks");
}

#[test]
fn test_oidc_metadata_deserialize() {
    let json = serde_json::json!({
        "issuer": "https://sso.example.com",
        "jwks_uri": "https://sso.example.com/api/auth/jwks",
        "id_token_signing_alg_values_supported": ["ES256", "RS256"]
    });

    let issuer = json.get("issuer").and_then(|v| v.as_str()).unwrap();
    let jwks_uri = json.get("jwks_uri").and_then(|v| v.as_str()).unwrap();
    let algs = json
        .get("id_token_signing_alg_values_supported")
        .and_then(|v| v.as_array())
        .unwrap();

    assert_eq!(issuer, "https://sso.example.com");
    assert_eq!(jwks_uri, "https://sso.example.com/api/auth/jwks");
    assert_eq!(algs.len(), 2);
}

#[test]
fn test_get_supported_algorithms() {
    let cache = JwksCache::new();
    cache.set_metadata_for_test(
        "https://sso.example.com",
        &["ES256", "RS256", "UNKNOWN_ALG"],
    );

    let validation = cache.validation();
    assert_eq!(validation.algorithms.len(), 2);
    assert!(validation.algorithms.contains(&Algorithm::ES256));
    assert!(validation.algorithms.contains(&Algorithm::RS256));
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

fn entry(secret: &[u8], cached_at: u64) -> JwksKeyEntry {
    JwksKeyEntry {
        key: DecodingKey::from_secret(secret),
        cached_at,
    }
}

#[test]
fn test_merge_keys_keeps_old_key_within_grace() {
    let now: u64 = 1_000_000;
    let mut old = HashMap::new();
    old.insert("old-kid".to_string(), entry(b"old", now - 3600));

    let mut new = HashMap::new();
    new.insert("new-kid".to_string(), DecodingKey::from_secret(b"new"));

    let merged = merge_keys(&old, new, now, JWKS_KEY_GRACE_SECS);

    // 新 key 收录 + 宽限期内的旧 key 保留（上游残缺响应防护）
    assert!(merged.contains_key("new-kid"));
    assert!(merged.contains_key("old-kid"));
    assert_eq!(merged["new-kid"].cached_at, now);
}

#[test]
fn test_merge_keys_drops_old_key_past_grace() {
    let now: u64 = 1_000_000;
    let mut old = HashMap::new();
    old.insert(
        "stale-kid".to_string(),
        entry(b"stale", now - JWKS_KEY_GRACE_SECS - 1),
    );
    old.insert("fresh-kid".to_string(), entry(b"fresh", now - 60));

    let mut new = HashMap::new();
    new.insert("rotated".to_string(), DecodingKey::from_secret(b"rotated"));

    let merged = merge_keys(&old, new, now, JWKS_KEY_GRACE_SECS);

    assert!(merged.contains_key("rotated"));
    assert!(merged.contains_key("fresh-kid"));
    assert!(!merged.contains_key("stale-kid"));
}

#[test]
fn test_merge_keys_prefers_new_entry_for_same_kid() {
    let now: u64 = 1_000_000;
    let mut old = HashMap::new();
    old.insert(
        "kid".to_string(),
        entry(b"old", now - JWKS_KEY_GRACE_SECS + 1),
    );

    let mut new = HashMap::new();
    new.insert("kid".to_string(), DecodingKey::from_secret(b"new"));

    let merged = merge_keys(&old, new, now, JWKS_KEY_GRACE_SECS);

    // 同 kid 以新 key + 新 cached_at 为准
    assert_eq!(merged.len(), 1);
    assert_eq!(merged["kid"].cached_at, now);
}
