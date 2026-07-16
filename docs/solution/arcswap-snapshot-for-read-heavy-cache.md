# 读多写少缓存的 ArcSwap 快照模式

> 来源：Gateway 性能审计 D1（JWKS 缓存锁竞争 + 锁中毒降级分支扩散），2026-07-16 重构。

## 问题

JWKS 公钥缓存曾用 `RwLock<OidcMetadata>`。读写比极端悬殊（每 300s 写一次 vs 每请求读多次），带来两类成本：

1. **热路径同步点**：验签路径 `key()` + `validation()` 两次读锁 + 一次 `DecodingKey` 堆拷贝。
2. **锁中毒的降级分支扩散**：每个读方法都要处理 `PoisonError`，5 处 `match self.inner.read()` 降级分支 + 专用 `JwksError::LockPoisoned` 变体，纯属防御性噪音。

## 模式

读写比悬殊 + 写入是「整体替换」而非「原地修改」时，用 `ArcSwap<T>` 存不可变快照：

```rust
pub struct JwksCache { inner: ArcSwap<OidcMetadata> }

/// 热路径：一次 wait-free load 同时获得全部字段，零锁零拷贝
pub(crate) fn snapshot(&self) -> Arc<OidcMetadata> { self.inner.load_full() }

/// 写路径（300s 一次）：构建完整新快照后一次 store，天然原子
fn apply_discovery(&self, ...) -> Result<usize, JwksError> {
    self.inner.store(Arc::new(OidcMetadata { keys, validation, ... }));
}

/// 测试注入（冷路径）：load_full → clone → mutate → store
```

热路径消费方持快照读所有字段，借用而非拷贝：

```rust
let meta = self.jwks_cache.snapshot();          // 唯一一次原子 load
let key = meta.keys.get(&kid).ok_or(...)?;      // 借用，无 DecodingKey 拷贝
decode::<Claims>(token, key, &meta.validation)  // 同一快照，字段间天然一致
```

## 收益

- 每次验签 2 次读锁 + 1 次密钥堆拷贝 → 1 次 wait-free 原子 load、0 拷贝。
- **锁中毒类错误在类型上消失**：删除 `LockPoisoned` 变体与全部 5 处降级分支。
- **快照天然解决字段间一致性**：keys 与 validation 永远来自同一次 Discovery，不存在读到「新 keys + 旧 issuer」的撕裂。

## 适用判据与反例

适用：读多写少（写频率 ≤ 秒级）、写入为整体替换、读方需要多字段一致视图。典型如配置热更新、公钥/证书缓存、路由表。

不适用：

- 高频细粒度写（如计数器）→ 用 `AtomicU64` / 分片锁。
- 写入需要读-改-写且写方并发 → `ArcSwap::rcu` 或退回 `Mutex`。
- 单字段小值 → `ArcSwapOption`/`OnceLock` 更轻。

另注意：`load()` 返回的 `Guard` 不宜长期持有（阻碍旧快照回收）；跨 await 或长逻辑用 `load_full()` 取 `Arc`。
