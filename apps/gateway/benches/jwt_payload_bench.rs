//! JWT Payload 裸解基准测试 (JWT Payload Decode Benchmarks)
//!
//! 测试 `decode_jwt_payload` 的性能 —— 在续签路径上裸解新的 Access Token payload
//! 以提取 `sub` 和 `jti`，无需密码学验签。

use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};
use gateway::auth::Claims;
use gateway::auth::decode_jwt_payload;
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};

/// 生成一个与生产环境一致的 HS256 JWT（用于 bench 的纯 CPU 操作）
fn make_test_jwt(sub: &str, jti: &str) -> String {
    let claims = Claims {
        sub: sub.to_string(),
        iss: "https://sso.example.com".to_string(),
        aud: "portal-client".to_string(),
        exp: 9999999999u64,
        jti: jti.to_string(),
    };
    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(b"bench-secret-key-for-hs256-min-32-bytes!!"),
    )
    .expect("JWT encoding for bench setup should succeed")
}

fn bench_decode_valid_jwt(c: &mut Criterion) {
    let token = make_test_jwt("user-123", "jti-456");
    // 验证 token 可解码
    assert!(decode_jwt_payload(&token).is_some());

    c.bench_function("jwt/decode_valid_payload", |b| {
        b.iter(|| {
            let result = decode_jwt_payload(black_box(&token));
            black_box(result)
        })
    });
}

fn bench_decode_long_claims_jwt(c: &mut Criterion) {
    // 模拟权限较多的用户
    let token = make_test_jwt(
        "user-with-many-permissions-and-a-very-long-subject-identifier",
        "jti-very-long-identifier-for-benchmarking-decoding-performance",
    );
    assert!(decode_jwt_payload(&token).is_some());

    c.bench_function("jwt/decode_long_claims_payload", |b| {
        b.iter(|| {
            let result = decode_jwt_payload(black_box(&token));
            black_box(result)
        })
    });
}

fn bench_decode_invalid_jwt(c: &mut Criterion) {
    c.bench_function("jwt/decode_invalid_format", |b| {
        b.iter(|| {
            let result = decode_jwt_payload(black_box("not.a.valid.jwt.token"));
            black_box(result)
        })
    });
}

fn bench_decode_empty_string(c: &mut Criterion) {
    c.bench_function("jwt/decode_empty_string", |b| {
        b.iter(|| {
            let result = decode_jwt_payload(black_box(""));
            black_box(result)
        })
    });
}

fn bench_decode_malformed_base64(c: &mut Criterion) {
    let malformed = "header.!@#$%^.signature";
    c.bench_function("jwt/decode_malformed_base64", |b| {
        b.iter(|| {
            let result = decode_jwt_payload(black_box(malformed));
            black_box(result)
        })
    });
}

criterion_group!(
    benches,
    bench_decode_valid_jwt,
    bench_decode_long_claims_jwt,
    bench_decode_invalid_jwt,
    bench_decode_empty_string,
    bench_decode_malformed_base64,
);
criterion_main!(benches);
