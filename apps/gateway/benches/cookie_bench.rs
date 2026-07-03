//! Cookie 解析与操作基准测试 (Cookie Parsing & Manipulation Benchmarks)
//!
//! 测试网关热路径上的 Cookie 操作性能：
//! - Cookie 请求头中提取 Token（零拷贝）
//! - Set-Cookie 响应头解析
//! - Cookie 头移除和替换（内存分配路径）
//!
//! 这些操作在每次请求中至少执行一次（验签路径），
//! 高并发场景下对延迟有显著影响。

use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};
use gateway::cookie;

/// 典型的生产环境 Cookie 头部（含 Access Token、Refresh Token、其他 Cookie）
const TYPICAL_COOKIE_HEADER: &str = "portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6ImtleS0xIn0.eyJzdWIiOiJ1c2VyLTEyMyIsImlzcyI6Imh0dHBzOi8vc3NvLmV4YW1wbGUuY29tIiwiYXVkIjoicG9ydGFsLWNsaWVudCIsImV4cCI6OTk5OTk5OTk5OSwianRpIjoianRpLTEyMyIsInJvbGVzIjpbIkFETUlOIl0sInBlcm1pc3Npb25zIjpbInVzZXI6bGlzdCJdLCJkZXB0SWRzIjpbImRlcHQtMSJdfQ.signature; portal_refresh_token=rt_abcdefghijklmnopqrstuvwxyz1234567890; _ga=GA1.1.123456789.1234567890; _ga_SESSION=session_data";

/// 典型的 Set-Cookie 响应头
const TYPICAL_SET_COOKIE: &str = "portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6ImtleS0xIn0.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600";

// ── extract_from_header ──

fn bench_extract_at_from_header(c: &mut Criterion) {
    c.bench_function("cookie/extract_at_from_header", |b| {
        b.iter(|| {
            let result =
                cookie::extract_from_header(black_box(TYPICAL_COOKIE_HEADER), "portal_jwt_token");
            black_box(result)
        })
    });
}

fn bench_extract_rt_from_header(c: &mut Criterion) {
    c.bench_function("cookie/extract_rt_from_header", |b| {
        b.iter(|| {
            let result = cookie::extract_from_header(
                black_box(TYPICAL_COOKIE_HEADER),
                "portal_refresh_token",
            );
            black_box(result)
        })
    });
}

fn bench_extract_missing_from_header(c: &mut Criterion) {
    c.bench_function("cookie/extract_missing_from_header", |b| {
        b.iter(|| {
            let result =
                cookie::extract_from_header(black_box(TYPICAL_COOKIE_HEADER), "nonexistent");
            black_box(result)
        })
    });
}

// ── extract_from_set_cookie ──

fn bench_extract_at_from_set_cookie(c: &mut Criterion) {
    c.bench_function("cookie/extract_at_from_set_cookie", |b| {
        b.iter(|| {
            let result =
                cookie::extract_from_set_cookie(black_box(TYPICAL_SET_COOKIE), "portal_jwt_token");
            black_box(result)
        })
    });
}

fn bench_extract_missing_from_set_cookie(c: &mut Criterion) {
    c.bench_function("cookie/extract_missing_from_set_cookie", |b| {
        b.iter(|| {
            let result = cookie::extract_from_set_cookie(
                black_box(TYPICAL_SET_COOKIE),
                "portal_refresh_token",
            );
            black_box(result)
        })
    });
}

// ── remove_from_header ──

fn bench_remove_rt_from_header(c: &mut Criterion) {
    c.bench_function("cookie/remove_rt_from_header", |b| {
        b.iter(|| {
            let result = cookie::remove_from_header(
                black_box(TYPICAL_COOKIE_HEADER),
                "portal_refresh_token",
            );
            black_box(result)
        })
    });
}

fn bench_remove_at_from_header(c: &mut Criterion) {
    c.bench_function("cookie/remove_at_from_header", |b| {
        b.iter(|| {
            let result =
                cookie::remove_from_header(black_box(TYPICAL_COOKIE_HEADER), "portal_jwt_token");
            black_box(result)
        })
    });
}

// ── replace_in_header ──

fn bench_replace_existing_at_in_header(c: &mut Criterion) {
    c.bench_function("cookie/replace_existing_at_in_header", |b| {
        b.iter(|| {
            let result = cookie::replace_in_header(
                black_box(TYPICAL_COOKIE_HEADER),
                "portal_jwt_token",
                black_box("new_token_value_here_12345"),
            );
            black_box(result)
        })
    });
}

fn bench_replace_append_missing_in_header(c: &mut Criterion) {
    let header = "portal_refresh_token=rt_abc; other=val";
    c.bench_function("cookie/replace_append_missing_in_header", |b| {
        b.iter(|| {
            let result = cookie::replace_in_header(
                black_box(header),
                "portal_jwt_token",
                black_box("new_token_value"),
            );
            black_box(result)
        })
    });
}

criterion_group!(
    benches,
    bench_extract_at_from_header,
    bench_extract_rt_from_header,
    bench_extract_missing_from_header,
    bench_extract_at_from_set_cookie,
    bench_extract_missing_from_set_cookie,
    bench_remove_rt_from_header,
    bench_remove_at_from_header,
    bench_replace_existing_at_in_header,
    bench_replace_append_missing_in_header,
);
criterion_main!(benches);
