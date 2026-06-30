//! 速率限制器基准测试 (Rate Limiter Benchmarks)
//!
//! 测试 `is_over_limit` 同步无 IO 限流判定性能。
//! 基于 `pingora-limits` 的 `Rate`（无锁双桶滑动窗口），
//! 在认证端点的热路径上每条请求都会执行一次。

use criterion::{Criterion, black_box, criterion_group, criterion_main};
use gateway::rate_limiter::is_over_limit;

fn bench_auth_endpoint_rate_check(c: &mut Criterion) {
    c.bench_function("rate_limit/auth_endpoint", |b| {
        b.iter(|| {
            let result = is_over_limit(black_box("192.168.1.100"), black_box("/api/auth/session"));
            black_box(result)
        })
    });
}

fn bench_token_endpoint_rate_check(c: &mut Criterion) {
    c.bench_function("rate_limit/token_endpoint", |b| {
        b.iter(|| {
            let result = is_over_limit(black_box("10.0.0.55"), black_box("/api/auth/oauth2/token"));
            black_box(result)
        })
    });
}

fn bench_no_limit_path(c: &mut Criterion) {
    c.bench_function("rate_limit/no_limit_path", |b| {
        b.iter(|| {
            let result = is_over_limit(black_box("10.0.0.1"), black_box("/dashboard/users"));
            black_box(result)
        })
    });
}

fn bench_different_ips_token_endpoint(c: &mut Criterion) {
    // 模拟多 IP 并发请求同一端点，测试 Rate 内部的哈希表性能
    let ips: Vec<String> = (0..100).map(|i| format!("192.168.1.{}", i)).collect();

    c.bench_function("rate_limit/many_ips_token_endpoint", |b| {
        let mut idx = 0usize;
        b.iter(|| {
            let ip = black_box(&ips[idx % ips.len()]);
            idx = idx.wrapping_add(1);
            let result = is_over_limit(ip, black_box("/api/auth/oauth2/token"));
            black_box(result)
        })
    });
}

criterion_group!(
    benches,
    bench_auth_endpoint_rate_check,
    bench_token_endpoint_rate_check,
    bench_no_limit_path,
    bench_different_ips_token_endpoint,
);
criterion_main!(benches);
