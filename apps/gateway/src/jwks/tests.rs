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
        key: Arc::new(DecodingKey::from_secret(secret)),
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

// ── key() 的查询期宽限期判定（生产验签路径的必经之处）──
//
// 此前只有 merge_keys 的合并期裁剪被测，而 `key()` 自身的时间判定零覆盖。
// verify.rs 现经由 `key()` 取公钥，故该判定直接决定"轮换期间旧 key 还能不能用"。

#[test]
fn test_key_returns_fresh_entry() {
    let cache = JwksCache::new();
    let now = crate::http::unix_secs().unwrap_or(0);
    cache.insert_key_with_cached_at_for_test(
        "fresh".to_string(),
        DecodingKey::from_secret(b"k"),
        now,
    );

    assert!(cache.key("fresh").is_some());
}

#[test]
fn test_key_returns_entry_within_grace() {
    let cache = JwksCache::new();
    let now = crate::http::unix_secs().unwrap_or(0);
    cache.insert_key_with_cached_at_for_test(
        "within".to_string(),
        DecodingKey::from_secret(b"k"),
        now - JWKS_KEY_GRACE_SECS + 60,
    );

    assert!(cache.key("within").is_some(), "宽限期内应仍可用");
}

#[test]
fn test_key_hides_entry_past_grace() {
    let cache = JwksCache::new();
    let now = crate::http::unix_secs().unwrap_or(0);
    cache.insert_key_with_cached_at_for_test(
        "stale".to_string(),
        DecodingKey::from_secret(b"k"),
        now - JWKS_KEY_GRACE_SECS - 60,
    );

    assert!(cache.key("stale").is_none(), "宽限期外的条目应视为不存在");
}

#[test]
fn test_key_unknown_kid_is_none() {
    let cache = JwksCache::new();
    assert!(cache.key("never-inserted").is_none());
}

/// 边界：恰好等于宽限期即视为过期（判定为严格小于）
#[test]
fn test_key_boundary_at_exactly_grace_is_expired() {
    let cache = JwksCache::new();
    let now = crate::http::unix_secs().unwrap_or(0);
    cache.insert_key_with_cached_at_for_test(
        "boundary".to_string(),
        DecodingKey::from_secret(b"k"),
        now - JWKS_KEY_GRACE_SECS,
    );

    assert!(
        cache.key("boundary").is_none(),
        "now - cached_at == GRACE 不在宽限期内"
    );
}

// ── 自定义 Discovery 扩展字段（RFC 8414 §2 命名空间 + 部署错序容忍）──
//
// 旧名 `refresh_endpoint` / `oauth_callback_path` 无命名空间，会与注册字段名
// 冲突，并让外部 RP 误以为存在标准 refresh_token grant 支持。改名后需容忍
// 旧名，否则 Portal/Gateway 部署错序会断掉续签。

#[test]
fn custom_field_prefers_namespaced_name() {
    let meta = serde_json::json!({
        "com_authsso_refresh_endpoint": "/new",
        "refresh_endpoint": "/legacy",
    });

    let v = custom_field(&meta, CUSTOM_FIELD_REFRESH_ENDPOINT).unwrap();
    assert_eq!(v.as_str().unwrap(), "/new", "新名存在时必须优先");
}

#[test]
fn custom_field_falls_back_to_legacy_name() {
    let meta = serde_json::json!({ "refresh_endpoint": "/legacy" });

    let v = custom_field(&meta, CUSTOM_FIELD_REFRESH_ENDPOINT).unwrap();
    assert_eq!(
        v.as_str().unwrap(),
        "/legacy",
        "仅旧名存在时应回退，不得断掉续签"
    );
}

#[test]
fn custom_field_returns_none_when_neither_present() {
    let meta = serde_json::json!({ "issuer": "https://sso.example.com" });

    assert!(custom_field(&meta, CUSTOM_FIELD_REFRESH_ENDPOINT).is_none());
    assert!(custom_field(&meta, CUSTOM_FIELD_CALLBACK_PATH).is_none());
}

#[test]
fn custom_field_callback_path_tolerance() {
    let legacy = serde_json::json!({ "oauth_callback_path": "/api/auth/callback" });
    let current = serde_json::json!({ "com_authsso_callback_path": "/api/auth/cb" });

    assert_eq!(
        custom_field(&legacy, CUSTOM_FIELD_CALLBACK_PATH)
            .unwrap()
            .as_str()
            .unwrap(),
        "/api/auth/callback"
    );
    assert_eq!(
        custom_field(&current, CUSTOM_FIELD_CALLBACK_PATH)
            .unwrap()
            .as_str()
            .unwrap(),
        "/api/auth/cb"
    );
}

/// 常量顺序即优先级：新（带命名空间）在前，旧在后。顺序被改会静默改变优先级。
#[test]
fn custom_field_constants_are_namespaced_first() {
    assert_eq!(
        CUSTOM_FIELD_REFRESH_ENDPOINT[0],
        "com_authsso_refresh_endpoint"
    );
    assert_eq!(CUSTOM_FIELD_REFRESH_ENDPOINT[1], "refresh_endpoint");
    assert_eq!(CUSTOM_FIELD_CALLBACK_PATH[0], "com_authsso_callback_path");
    assert_eq!(CUSTOM_FIELD_CALLBACK_PATH[1], "oauth_callback_path");
}
