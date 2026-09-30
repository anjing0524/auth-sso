use std::sync::Arc;

use super::VerifyError;
use super::*;
use crate::jwks::JwksCache;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, encode};
use p256::ecdsa::SigningKey;
use p256::pkcs8::EncodePrivateKey;
use p256::pkcs8::EncodePublicKey;

fn generate_es256_key() -> (String, Vec<u8>, Vec<u8>) {
    let signing_key = SigningKey::random(&mut rand::thread_rng());
    let verifying_key = signing_key.verifying_key();
    let kid = "test-es256-key";

    let private_pem = signing_key
        .to_pkcs8_pem(p256::pkcs8::LineEnding::LF)
        .unwrap()
        .as_bytes()
        .to_vec();
    let public_pem = verifying_key
        .to_public_key_pem(p256::pkcs8::LineEnding::LF)
        .unwrap()
        .as_bytes()
        .to_vec();

    (kid.to_string(), private_pem, public_pem)
}

fn make_test_verifier(jwks_cache: &Arc<JwksCache>) -> JwtVerifier {
    JwtVerifier::new_without_revocation_for_test(Arc::clone(jwks_cache))
}

/// 生成测试用 ES256 JWT（与生产环境签名算法一致）
fn make_test_token(
    kid: &str,
    private_key_pem: &[u8],
    issuer: &str,
    sub: &str,
    jti: &str,
    exp_offset_sec: i64,
) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let claims = Claims {
        sub: sub.to_string(),
        iss: issuer.to_string(),
        // 与生产签发语义对齐（ADR-013）：AT aud = 签发对象 client_id
        aud: "portal".to_string(),
        client_id: "portal".to_string(),
        exp: (now as i64 + exp_offset_sec) as u64,
        jti: jti.to_string(),
    };
    let mut header = Header::new(Algorithm::ES256);
    header.kid = Some(kid.to_string());
    // 与 Portal 签发端对齐（contracts JWT_TYP.ACCESS_TOKEN，RFC 8725 §3.11）
    header.typ = Some("at+jwt".to_string());
    encode(
        &header,
        &claims,
        &EncodingKey::from_ec_pem(private_key_pem).unwrap(),
    )
    .unwrap()
}

#[tokio::test]
async fn test_verify_es256_jwt_successful() {
    let jwks_cache = Arc::new(JwksCache::new());
    let issuer = "https://sso.example.com";
    let (kid, private_pem, public_pem) = generate_es256_key();

    jwks_cache.set_metadata_for_test(issuer, &["ES256"]);
    jwks_cache.insert_key_for_test(kid.clone(), DecodingKey::from_ec_pem(&public_pem).unwrap());

    let verifier = make_test_verifier(&jwks_cache);
    let token = make_test_token(
        &kid,
        &private_pem,
        issuer,
        "user-123",
        "unit-verify-success-jti",
        3600,
    );

    let result = verifier.verify(&token).await;
    let status = result.expect("expected valid token");
    assert!(matches!(status.expiry, TokenExpiry::Valid));
    assert_eq!(status.token.user_id, "user-123");
    assert_eq!(status.token.jti, "unit-verify-success-jti");
}

#[tokio::test]
async fn test_verify_es256_jwt_expired() {
    let jwks_cache = Arc::new(JwksCache::new());
    let issuer = "https://sso.example.com";
    let (kid, private_pem, public_pem) = generate_es256_key();

    jwks_cache.set_metadata_for_test(issuer, &["ES256"]);
    jwks_cache.insert_key_for_test(kid.clone(), DecodingKey::from_ec_pem(&public_pem).unwrap());

    let verifier = make_test_verifier(&jwks_cache);
    let token = make_test_token(
        &kid,
        &private_pem,
        issuer,
        "user-123",
        "unit-verify-expired-jti",
        -600,
    );

    let result = verifier.verify(&token).await;
    assert!(matches!(
        result,
        Ok(TokenStatus {
            expiry: TokenExpiry::Expired,
            ..
        })
    ));
}

#[tokio::test]
async fn test_verify_es256_jwt_invalid_issuer() {
    let jwks_cache = Arc::new(JwksCache::new());
    let issuer = "https://sso.example.com";
    let (kid, private_pem, public_pem) = generate_es256_key();

    jwks_cache.set_metadata_for_test(issuer, &["ES256"]);
    jwks_cache.insert_key_for_test(kid.clone(), DecodingKey::from_ec_pem(&public_pem).unwrap());

    let verifier = make_test_verifier(&jwks_cache);
    let token = make_test_token(
        &kid,
        &private_pem,
        "https://hacker.com",
        "user-123",
        "jti-123",
        3600,
    );

    let result = verifier.verify(&token).await;
    assert!(matches!(result, Err(VerifyError::InvalidToken(_))));
}

#[tokio::test]
async fn test_verify_es256_jwt_unknown_kid() {
    let jwks_cache = Arc::new(JwksCache::new());
    let issuer = "https://sso.example.com";
    let (kid, private_pem, public_pem) = generate_es256_key();

    jwks_cache.set_metadata_for_test(issuer, &["ES256"]);
    jwks_cache.insert_key_for_test(
        "known-key".to_string(),
        DecodingKey::from_ec_pem(&public_pem).unwrap(),
    );

    let verifier = make_test_verifier(&jwks_cache);
    let token = make_test_token(&kid, &private_pem, issuer, "user-123", "jti-123", 3600);

    let result = verifier.verify(&token).await;
    assert!(matches!(result, Err(VerifyError::UnknownKid(k)) if k == kid));
}

#[test]
fn test_decode_jwt_payload() {
    let (kid, private_pem, _public_pem) = generate_es256_key();
    let claims = Claims {
        sub: "user-1".to_string(),
        iss: "test".to_string(),
        aud: "test".to_string(),
        client_id: "test".to_string(),
        exp: 9999999999u64,
        jti: "jti-1".to_string(),
    };
    let mut header = Header::new(Algorithm::ES256);
    header.kid = Some(kid);
    let token = encode(
        &header,
        &claims,
        &EncodingKey::from_ec_pem(&private_pem).unwrap(),
    )
    .unwrap();
    let decoded = decode_jwt_payload(&token).unwrap();
    assert_eq!(decoded.sub, "user-1");
    assert_eq!(decoded.exp, 9999999999u64);
    assert_eq!(decoded.jti, "jti-1");
}

#[test]
fn test_decode_jwt_payload_invalid() {
    assert!(decode_jwt_payload("not.a.jwt").is_none());
    assert!(decode_jwt_payload("").is_none());
}

/// T7-01: JWT alg 混淆攻击 — HS256 签名的 JWT 被拒绝
///
/// 攻击者可能尝试将 ES256 公钥作为 HMAC 密钥签发 HS256 JWT。
/// Gateway 通过 JWKS 元数据中的算法白名单硬锁 ES256，非 ES256 算法一律拒绝。
#[tokio::test]
async fn test_verify_rejects_hs256_algorithm_confusion() {
    let jwks_cache = Arc::new(JwksCache::new());
    let issuer = "https://sso.example.com";

    // JWKS 缓存声明仅接受 ES256（零信任：不认 token header 的 alg）
    jwks_cache.set_metadata_for_test(issuer, &["ES256"]);

    let verifier = make_test_verifier(&jwks_cache);

    // 使用 HS256 签发（攻击者用公钥作为 HMAC 密钥的场景）
    let claims = Claims {
        sub: "user-123".to_string(),
        iss: issuer.to_string(),
        aud: "portal".to_string(),
        client_id: "portal".to_string(),
        exp: 9999999999u64,
        jti: "jti-456".to_string(),
    };
    let mut header = Header::new(Algorithm::HS256);
    header.kid = Some("test-es256-key".to_string());
    header.typ = Some("at+jwt".to_string());
    let token = encode(
        &header,
        &claims,
        &EncodingKey::from_secret(b"attacker-secret"),
    )
    .unwrap();

    let result = verifier.verify(&token).await;
    // HS256 签名应被拒绝（JWKS 白名单仅含 ES256）
    assert!(result.is_err());
}

/// RFC 8725 §3.11 显式类型：typ 与预期用途不符的 JWT 被拒绝（如 login 凭证冒充 AT）
#[tokio::test]
async fn test_verify_rejects_mismatched_typ() {
    let jwks_cache = Arc::new(JwksCache::new());
    let issuer = "https://sso.example.com";
    let (kid, private_pem, public_pem) = generate_es256_key();

    jwks_cache.set_metadata_for_test(issuer, &["ES256"]);
    jwks_cache.insert_key_for_test(kid.clone(), DecodingKey::from_ec_pem(&public_pem).unwrap());

    let claims = Claims {
        sub: "user-123".to_string(),
        iss: issuer.to_string(),
        aud: "auth-sso".to_string(),
        client_id: "portal".to_string(),
        exp: 9999999999u64,
        jti: "jti-typ-1".to_string(),
    };
    let mut header = Header::new(Algorithm::ES256);
    header.kid = Some(kid.clone());
    header.typ = Some("login+jwt".to_string());
    let token = encode(
        &header,
        &claims,
        &EncodingKey::from_ec_pem(&private_pem).unwrap(),
    )
    .unwrap();

    let verifier = make_test_verifier(&jwks_cache);
    let result = verifier.verify(&token).await;
    assert!(matches!(result, Err(VerifyError::InvalidTokenType(t)) if t == "login+jwt"));
}

/// RFC 8725 §3.11 + ADR-013 决策 2：typ 强制存在——缺失 typ 的 token 拒绝
/// （系统无生产存量，F11 的"缺失放行"兼容窗已收紧关闭）
#[tokio::test]
async fn test_verify_rejects_missing_typ() {
    let jwks_cache = Arc::new(JwksCache::new());
    let issuer = "https://sso.example.com";
    let (kid, private_pem, public_pem) = generate_es256_key();

    jwks_cache.set_metadata_for_test(issuer, &["ES256"]);
    jwks_cache.insert_key_for_test(kid.clone(), DecodingKey::from_ec_pem(&public_pem).unwrap());

    let claims = Claims {
        sub: "user-123".to_string(),
        iss: issuer.to_string(),
        aud: "portal".to_string(),
        client_id: "portal".to_string(),
        exp: 9999999999u64,
        jti: "jti-typ-2".to_string(),
    };
    let mut header = Header::new(Algorithm::ES256);
    header.kid = Some(kid.clone());
    header.typ = None; // Header::new 默认 Some("JWT")，须显式清除以模拟无 typ token
    let token = encode(
        &header,
        &claims,
        &EncodingKey::from_ec_pem(&private_pem).unwrap(),
    )
    .unwrap();

    let verifier = make_test_verifier(&jwks_cache);
    let result = verifier.verify(&token).await;
    assert!(
        matches!(result, Err(VerifyError::MissingTyp)),
        "typ 缺失的 token 应被拒绝: {:?}",
        result.err()
    );
}

/// T6-01: NearlyExpired Token 验签通过但标记为即将过期
#[tokio::test]
async fn test_verify_es256_jwt_nearly_expired() {
    let jwks_cache = Arc::new(JwksCache::new());
    let issuer = "https://sso.example.com";
    let (kid, private_pem, public_pem) = generate_es256_key();

    jwks_cache.set_metadata_for_test(issuer, &["ES256"]);
    jwks_cache.insert_key_for_test(kid.clone(), DecodingKey::from_ec_pem(&public_pem).unwrap());

    let verifier = make_test_verifier(&jwks_cache);

    // Token 在 120 秒后过期（< 300s NearlyExpired 阈值）
    let token = make_test_token(&kid, &private_pem, issuer, "user-123", "jti-nearly", 120);

    let result = verifier.verify(&token).await;
    let status = result.expect("expected valid but nearly-expired token");
    assert!(matches!(status.expiry, TokenExpiry::NearlyExpired));
    assert_eq!(status.token.user_id, "user-123");
}

/// 无效签名（篡改后的 JWT）被拒绝
#[tokio::test]
async fn test_verify_rejects_tampered_signature() {
    let jwks_cache = Arc::new(JwksCache::new());
    let issuer = "https://sso.example.com";
    let (kid, private_pem, public_pem) = generate_es256_key();

    jwks_cache.set_metadata_for_test(issuer, &["ES256"]);
    jwks_cache.insert_key_for_test(kid.clone(), DecodingKey::from_ec_pem(&public_pem).unwrap());

    let verifier = make_test_verifier(&jwks_cache);

    // 签发正确的 token，然后篡改 payload
    let valid_token = make_test_token(&kid, &private_pem, issuer, "user-123", "jti-789", 3600);
    // 修改最后一个字符，签名应该失效
    let tampered = format!("{}X", &valid_token[..valid_token.len() - 1]);

    let result = verifier.verify(&tampered).await;
    assert!(matches!(result, Err(VerifyError::InvalidToken(_))));
}

#[test]
fn jwt_claims_match_cross_language_contract() {
    // A5-3：claims 字段契约以 packages/contracts/src/jwt-claims-fixture.json
    // 为唯一真相源 —— TS 侧（Portal 签发语义）与 Rust 侧（Gateway 验签结构）
    // 双端测试消费同一 fixture，杜绝跨语言漂移。
    let raw = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/contracts/src/jwt-claims-fixture.json"
    ));
    let claims: Claims =
        serde_json::from_str(raw).expect("fixture 必须能反序列化为 Gateway Claims");
    assert_eq!(
        claims.aud, "portal",
        "AT aud = 签发对象 client_id（ADR-013）"
    );
    assert_eq!(
        claims.client_id, "portal",
        "client_id claim 与 aud 同源同值（ADR-013）"
    );
    assert!(
        claims.iss.starts_with("https://"),
        "issuer 为 URL（ADR-012）"
    );
    assert!(
        claims.jti.starts_with("jti_"),
        "jti 前缀契约（Redis 黑名单键空间）"
    );
    assert!(!claims.sub.is_empty());
    // Gateway Claims 消费 Portal claims 的子集：iat 不在 Claims 中，
    // 由 Portal 侧 jwt-contract.test.ts 保障 exp - iat = 3600 契约。
}
