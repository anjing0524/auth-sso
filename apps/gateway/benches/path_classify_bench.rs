//! 路径分类基准测试 (Path Classification Benchmarks)
//!
//! 测试 `PathMatcher::classify` 在热路径上的性能表现。
//! 每条请求路径在 `request_filter` 中仅分类一次，结果在全生命周期中复用。
//!
//! 分类优先级：Static → Public → Microservice → Protected (default)

use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};
use gateway::path_matcher::{PathClass, PathMatcher};

/// 构建一个与生产配置一致的 PathMatcher 实例
fn make_production_matcher() -> PathMatcher {
    PathMatcher::new(vec![
        "/login".into(),
        "/register".into(),
        "/error".into(),
        "/".into(),
        "/api/auth/".into(),
        "/oauth2/".into(),
        "/.well-known/".into(),
    ])
}

// ── 构造开销 ──

fn bench_path_matcher_construction(c: &mut Criterion) {
    let paths = vec![
        "/login".to_string(),
        "/register".to_string(),
        "/error".to_string(),
        "/".to_string(),
        "/api/auth/".to_string(),
        "/oauth2/".to_string(),
        "/.well-known/".to_string(),
    ];
    c.bench_function("path/construction", |b| {
        b.iter(|| {
            let m = PathMatcher::new(black_box(paths.clone()));
            black_box(m)
        })
    });
}

// ── Static 路径（跳过限流 & 鉴权）──

fn bench_classify_static_next(c: &mut Criterion) {
    let m = make_production_matcher();
    c.bench_function("path/classify_static_next", |b| {
        b.iter(|| {
            let c = m.classify(black_box("/_next/static/chunks/main-abc123.js"));
            black_box(c)
        })
    });
}

fn bench_classify_static_root(c: &mut Criterion) {
    let m = make_production_matcher();
    c.bench_function("path/classify_static_root", |b| {
        b.iter(|| {
            let c = m.classify(black_box("/static/images/logo.png"));
            black_box(c)
        })
    });
}

// ── Public 路径（跳过鉴权）──

fn bench_classify_public_exact(c: &mut Criterion) {
    let m = make_production_matcher();
    c.bench_function("path/classify_public_exact", |b| {
        b.iter(|| {
            let c = m.classify(black_box("/login"));
            black_box(c)
        })
    });
}

fn bench_classify_public_prefix(c: &mut Criterion) {
    let m = make_production_matcher();
    c.bench_function("path/classify_public_prefix", |b| {
        b.iter(|| {
            let c = m.classify(black_box(
                "/oauth2/authorize?client_id=portal&response_type=code",
            ));
            black_box(c)
        })
    });
}

fn bench_classify_public_static_ext(c: &mut Criterion) {
    let m = make_production_matcher();
    c.bench_function("path/classify_public_static_ext", |b| {
        b.iter(|| {
            let c = m.classify(black_box("/favicon.ico"));
            black_box(c)
        })
    });
}

// ── Microservice 路由 ──

fn bench_classify_microservice(c: &mut Criterion) {
    let m = make_production_matcher();
    c.bench_function("path/classify_microservice", |b| {
        b.iter(|| {
            let c = m.classify(black_box("/api/v1/users?page=1&perPage=20"));
            black_box(c)
        })
    });
}

// ── Protected 路径（默认，需完整鉴权）──

fn bench_classify_protected(c: &mut Criterion) {
    let m = make_production_matcher();
    c.bench_function("path/classify_protected", |b| {
        b.iter(|| {
            let c = m.classify(black_box("/dashboard/users/manage"));
            black_box(c)
        })
    });
}

// ── 正确性验证 ──

fn bench_classify_correctness(c: &mut Criterion) {
    let m = make_production_matcher();
    c.bench_function("path/classify_correctness_all_types", |b| {
        b.iter(|| {
            // 同时测试所有四种分类类型
            let s = m.classify(black_box("/_next/static/main.js"));
            let p_exact = m.classify(black_box("/login"));
            let p_prefix = m.classify(black_box("/api/auth/session"));
            let ms = m.classify(black_box("/api/v1/users"));
            let prot = m.classify(black_box("/dashboard"));

            black_box((s, p_exact, p_prefix, ms, prot))
        })
    });
    // 断言不被优化掉
    assert_eq!(m.classify("/_next/static/main.js"), PathClass::Static);
    assert_eq!(m.classify("/login"), PathClass::Public);
    assert_eq!(m.classify("/api/v1/users"), PathClass::Microservice);
    assert_eq!(m.classify("/dashboard"), PathClass::Protected);
}

criterion_group!(
    benches,
    bench_path_matcher_construction,
    bench_classify_static_next,
    bench_classify_static_root,
    bench_classify_public_exact,
    bench_classify_public_prefix,
    bench_classify_public_static_ext,
    bench_classify_microservice,
    bench_classify_protected,
    bench_classify_correctness,
);
criterion_main!(benches);
