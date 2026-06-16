# 2026-06-16 SSO 安全网关重构设计说明书 (Gateway Refactoring Spec)

本设计文档旨在遵循 Rust 核心哲学（类型安全、零成本抽象、高效并发、显式错误传递）对 `apps/gateway` 进行重构，以提升网关的稳定性和简洁性。

## 1. 背景与现状分析

SSO 安全网关作为系统的流量入口，在执行高并发代理 and 鉴权时，其性能和稳定性至关重要。当前实现存在以下可优化点：
1. **热路径上的异步读锁开销**：`JwksCache` 的公钥缓存使用 `tokio::sync::RwLock`，导致每次处理请求验证 JWT 时，均需要通过 `keys.read().await` 异步申请读锁。高并发场景下，频繁的任务调度和锁等待是不必要的。
2. **白名单匹配逻辑分散**：白名单的解析（精确匹配和前缀匹配拆分、排序）散落在 `main.rs` 中，而匹配与静态资产判断逻辑散落在 `gateway.rs` 中，导致模块间职责不清。
3. **泛化错误处理**：JWKS 缓存的 `refresh` 函数返回 `Result<(), Box<dyn Error>>`。不符合 Rust 对特定领域错误的精确表达要求。

---

## 2. 详细重构设计

### 2.1 消除热路径上的异步读锁 (`src/jwks.rs`)

由于 JWKS 公钥缓存的特性是**极度读多写少**（后台 5 分钟拉取刷新一次，而每个请求都需要读取），且读取操作仅为 O(1) 的 `HashMap` 键值查询和 `DecodingKey` 的轻量克隆，因此这部分读取无任何 I/O 阻塞或昂贵计算。

**改造设计**：
1. 将 `tokio::sync::RwLock` 替换为标准库的同步锁 `std::sync::RwLock`（无需 `.await`），在 `Gateway::verify_jwt` 时变为纯同步操作，消除异步锁竞争及上下文切换开销。
2. 封装 `JwksCache`，隐藏 `keys` 细节，对外提供 `pub fn get_key(&self, kid: &str) -> Option<DecodingKey>`，提升面向对象的封装度。

### 2.2 路由与白名单机制模块化 (`PathMatcher`)

**改造设计**：
在 `src/gateway.rs`（或专用模块）中抽象出 `PathMatcher` 结构体：
```rust
pub struct PathMatcher {
    public_exact_paths: HashSet<String>,
    public_prefix_paths: Vec<String>,
}

impl PathMatcher {
    pub fn new(public_paths: Option<Vec<String>>) -> Self;
    pub fn is_public(&self, path: &str) -> bool;
}
```
* **职责内聚**：将静态资源扩展名判断、精确路径哈希检索、前缀路径降序匹配的逻辑全权交给 `PathMatcher`。
* **简洁性**：
  * `main.rs` 初始化网关时，只需 `let path_matcher = PathMatcher::new(config.portal.public_paths.clone());`，不再需要繁琐的分类排序步骤。
  * `Gateway` 结构体只需要持有 `path_matcher: PathMatcher` 即可。

### 2.3 强类型错误系统设计 (`src/jwks.rs` 等)

**改造设计**：
定义专有的错误枚举类型：
```rust
#[derive(Debug)]
pub enum JwksError {
    Network(reqwest::Error),
    EmptyKeys,
}
```
并为 `JwksError` 实现 `std::fmt::Display` 和 `std::error::Error`。
使 `JwksCache::refresh` 返回 `Result<(), JwksError>`，替换原先的 `Box<dyn std::error::Error>`。

---

## 3. 测试与验证策略

1. **保留并继承已有单元测试**：确保 `test_public_asset_or_route` 等 8 个测试用例在重构后全部适配通过。
2. **运行测试**：执行 `cargo test`。
3. **格式化代码**：执行 `cargo fmt` 以保证 Rust 代码格式。
