//! JWKS 缓存读取基准测试 (JWKS Cache Read Benchmarks)
//!
//! 测试 `JwksCache` 在热路径上的 RwLock 读取性能：
//! - 根据 kid 查找公钥（每条验签请求执行一次）
//! - 获取 validation 配置引用（每条验签请求执行一次，Arc 共享）
//!
//! 这些操作使用 `RwLock::read()`，在高并发场景下是主要的同步点。

use std::hint::black_box;
use std::sync::Arc;

use criterion::{Criterion, criterion_group, criterion_main};
use gateway::jwks::JwksCache;
use jsonwebtoken::DecodingKey;

/// 构建预填充的 JWKS 缓存（模拟生产环境）
fn make_populated_cache(key_count: usize) -> Arc<JwksCache> {
    let cache = Arc::new(JwksCache::new());
    for i in 0..key_count {
        let kid = format!("key-{}", i);
        // 使用一个虚拟的 ES256 公钥（仅用于 bench，不验签）
        let key = DecodingKey::from_ec_der(
            // 这是一个最小化的 DER 编码的 P-256 公钥（bench only）
            &[
                0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06,
                0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00, 0x04, 0x30,
                0x81, 0x42, 0x00, 0x04, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a,
                0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
                0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26,
                0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x32, 0x33, 0x34,
                0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f,
            ],
        );
        cache.insert_key_for_test(kid, key);
    }
    // 设置 issuer 和算法
    cache.set_metadata_for_test("https://sso.example.com", &["ES256"]);
    cache
}

// ── key 查找 ──

fn bench_key_lookup_hit(c: &mut Criterion) {
    let cache = make_populated_cache(10);
    // 验证 key 存在
    assert!(cache.key("key-5").is_some());

    c.bench_function("jwks/key_lookup_hit", |b| {
        b.iter(|| {
            let result = cache.key(black_box("key-5"));
            black_box(result)
        })
    });
}

fn bench_key_lookup_miss(c: &mut Criterion) {
    let cache = make_populated_cache(10);
    assert!(cache.key("nonexistent-kid").is_none());

    c.bench_function("jwks/key_lookup_miss", |b| {
        b.iter(|| {
            let result = cache.key(black_box("nonexistent-kid"));
            black_box(result)
        })
    });
}

// ── validation 获取（Arc clone，热路径零拷贝）──

fn bench_validation_access(c: &mut Criterion) {
    let cache = make_populated_cache(5);

    c.bench_function("jwks/validation_access", |b| {
        b.iter(|| {
            let v = cache.validation();
            // 确保不被优化掉
            black_box(v.algorithms.len())
        })
    });
}

// ── 组合操作（模拟真实验签路径）──

fn bench_verify_path_combined(c: &mut Criterion) {
    let cache = make_populated_cache(5);

    c.bench_function("jwks/verify_path_combined", |b| {
        b.iter(|| {
            // 模拟验签路径：先查 key → 再获取 validation
            let key = cache.key(black_box("key-3"));
            let validation = cache.validation();
            black_box((key, validation))
        })
    });
}

// ── 并行读取下的缓存访问（高并发模拟）──

fn bench_concurrent_read_stress(c: &mut Criterion) {
    let cache = make_populated_cache(5);

    c.bench_function("jwks/concurrent_read_stress", |b| {
        b.iter(|| {
            // 模拟 8 个并发请求同时读取缓存
            let results: Vec<_> = (0..8)
                .map(|i| {
                    let kid = format!("key-{}", i % 5);
                    (cache.key(&kid), cache.validation().algorithms.len())
                })
                .collect();
            black_box(results)
        })
    });
}

criterion_group!(
    benches,
    bench_key_lookup_hit,
    bench_key_lookup_miss,
    bench_validation_access,
    bench_verify_path_combined,
    bench_concurrent_read_stress,
);
criterion_main!(benches);
