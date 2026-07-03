use std::sync::Arc;

use super::*;
// Claims is defined in super (auth/mod.rs)
use super::VerifyError;
use crate::jwks::JwksCache;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, encode};

fn make_test_verifier(jwks_cache: &Arc<JwksCache>) -> JwtVerifier {
    JwtVerifier::new(Arc::clone(jwks_cache))
}

/// 生成测试用 HS256 JWT
fn make_test_token(
    kid: &str,
    secret: &[u8],
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
        aud: "portal-client".to_string(),
        exp: (now as i64 + exp_offset_sec) as u64,
        jti: jti.to_string(),
        roles: vec!["ADMIN".to_string()],
        permissions: vec!["user:list".to_string()],
        dept_ids: vec!["dept-1".to_string()],
    };
    let mut header = Header::new(Algorithm::HS256);
    header.kid = Some(kid.to_string());
    encode(&header, &claims, &EncodingKey::from_secret(secret)).unwrap()
}

#[tokio::test]
async fn test_verify_jwt_successful() {
    let jwks_cache = Arc::new(JwksCache::new());
    let issuer = "https://sso.example.com";

    jwks_cache.set_metadata_for_test(issuer, &["HS256"]);

    let secret = b"super-secret-key-that-is-long-enough-for-hs256";
    let kid = "key-test-1";
    jwks_cache.insert_key_for_test(kid.to_string(), DecodingKey::from_secret(secret));

    let verifier = make_test_verifier(&jwks_cache);
    let token = make_test_token(kid, secret, issuer, "user-123", "jti-123", 3600);

    let result = verifier.verify(&token).await;
    let status = result.expect("expected valid token");
    assert!(matches!(status.expiry, TokenExpiry::Valid));
    assert_eq!(status.token.user_id, "user-123");
    assert_eq!(status.token.jti, "jti-123");
}

#[tokio::test]
async fn test_verify_jwt_expired() {
    let jwks_cache = Arc::new(JwksCache::new());
    let issuer = "https://sso.example.com";

    jwks_cache.set_metadata_for_test(issuer, &["HS256"]);

    let secret = b"super-secret-key-that-is-long-enough-for-hs256";
    let kid = "key-test-1";
    jwks_cache.insert_key_for_test(kid.to_string(), DecodingKey::from_secret(secret));

    let verifier = make_test_verifier(&jwks_cache);
    let token = make_test_token(kid, secret, issuer, "user-123", "jti-123", -600);

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
async fn test_verify_jwt_invalid_issuer() {
    let jwks_cache = Arc::new(JwksCache::new());
    let issuer = "https://sso.example.com";

    jwks_cache.set_metadata_for_test(issuer, &["HS256"]);

    let secret = b"super-secret-key-that-is-long-enough-for-hs256";
    let kid = "key-test-1";
    jwks_cache.insert_key_for_test(kid.to_string(), DecodingKey::from_secret(secret));

    let verifier = make_test_verifier(&jwks_cache);
    // 使用错误的 issuer 签发 token
    let token = make_test_token(
        kid,
        secret,
        "https://hacker.com",
        "user-123",
        "jti-123",
        3600,
    );

    let result = verifier.verify(&token).await;
    assert!(matches!(result, Err(VerifyError::InvalidToken(_))));
}

#[tokio::test]
async fn test_verify_jwt_invalid_kid() {
    let jwks_cache = Arc::new(JwksCache::new());
    let issuer = "https://sso.example.com";

    jwks_cache.set_metadata_for_test(issuer, &["HS256"]);

    let secret = b"super-secret-key-that-is-long-enough-for-hs256";
    // 注册 key-test-1，但 token 使用 unknown-kid
    jwks_cache.insert_key_for_test("key-test-1".to_string(), DecodingKey::from_secret(secret));

    let verifier = make_test_verifier(&jwks_cache);
    let token = make_test_token("unknown-kid", secret, issuer, "user-123", "jti-123", 3600);

    let result = verifier.verify(&token).await;
    assert!(matches!(result, Err(VerifyError::UnknownKid(k)) if k == "unknown-kid"));
}

#[test]
fn test_decode_jwt_payload() {
    let secret = b"sufficiently-long-secret-key-for-hs256!!";
    let claims = Claims {
        sub: "user-1".to_string(),
        iss: "test".to_string(),
        aud: "test".to_string(),
        exp: 9999999999u64,
        jti: "jti-1".to_string(),
        roles: vec!["ADMIN".to_string()],
        permissions: vec!["read".to_string()],
        dept_ids: vec!["dept-1".to_string()],
    };
    let token = encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(secret),
    )
    .unwrap();
    let decoded = decode_jwt_payload(&token).unwrap();
    assert_eq!(decoded.sub, "user-1");
    assert_eq!(decoded.exp, 9999999999u64);
    assert_eq!(decoded.jti, "jti-1");
    assert_eq!(decoded.roles, vec!["ADMIN"]);
}

#[test]
fn test_decode_jwt_payload_invalid() {
    assert!(decode_jwt_payload("not.a.jwt").is_none());
    assert!(decode_jwt_payload("").is_none());
}
