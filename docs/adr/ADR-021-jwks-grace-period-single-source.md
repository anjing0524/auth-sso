# ADR-021: JWKS 宽限期判定的唯一出处 —— 消除生产路径与查询 API 的重复

| 属性       | 值                                                                    |
|------------|-----------------------------------------------------------------------|
| **状态**   | implemented (2026-10-08)                                              |
| **日期**   | 2026-10-08                                                            |
| **决策者** | Auth-SSO 团队（improve-codebase-architecture 架构评审候选 ⑨）          |
| **影响范围** | `apps/gateway/src/jwks.rs`、`apps/gateway/src/auth/verify.rs`、`benches/jwks_cache_bench.rs` |

## 背景：同一条规则被独立实现了两遍

JWKS 公钥轮换有一个宽限期判定：**条目超过 `JWKS_KEY_GRACE_SECS`（24h）即视为不存在**，
用于防护上游轮换维护窗口返回残缺 JWKS 的情况。它被写了两份：

| 位置 | 实现 | 谁在用 |
|---|---|---|
| `auth/verify.rs:134-139` | `snapshot()` → `keys.get(&kid)` → `.filter(now - cached_at < GRACE)` | **生产验签路径** |
| `jwks.rs:213` `JwksCache::key()` | `load()` → `keys.get(kid)` → `.then(now - cached_at < GRACE)` | **只有基准测试** |

两处代码逐行等价，但是**两个独立实现**：改一处不会影响另一处。

### 为什么这是个真问题（而不只是重复）

`key()` 是 `#[doc(hidden)]` 之外的公开 API，语义是"取某个 kid 的公钥"。
它与生产路径返回**同一个逻辑值**，因此它天然会被当作"这条规则的 API"——
基准测试正是这么用的。但它**没有**被生产使用，于是：

1. 它是**唯一有基准覆盖**的实现（`jwks_cache_bench` 的 5 个基准全部走 `key()`）；
2. 生产实际走的 `verify.rs` 内联版本**完全没有基准**；
3. 任何对宽限期的修改（改时长、改判定方向）都必须记得改两处。

也就是说：**性能基线测的是一条不存在的路径**，而真实路径没有基线。
这是架构评审候选 ⑨ "benchmark 测死路径"的具体形态。

## 决策

### 1. 让 `key()` 成为宽限期判定的唯一出处，生产路径改用它

`verify.rs` 从"`snapshot()` + 手工过滤"改为：

```rust
let meta = self.jwks_cache.snapshot();          // validation 仍来自快照
let key = self.jwks_cache.key(&kid).ok_or_else(|| { /* UnknownKid + 按需刷新 */ })?;
// ...
decode::<Claims>(token, &key, &meta.validation)
```

`snapshot()` 仍被调用——`validation`（预构建校验配置）仍从它取。取公钥则统一经 `key()`。

### 2. `JwksKeyEntry.key` 改存 `Arc<DecodingKey>`，使 `key()` 可以便宜

这是让第 1 条成立的**前提**，而不是顺带的优化：

- 原 `key()` 返回 `entry.key.clone()`。`DecodingKey` 内部是 `Vec<u8>`
  （`DecodingKeyKind::SecretOrDer`），克隆是**堆分配**。
- 生产路径原先刻意借引用（`.map(|entry| &entry.key)`）就是为了避免这次分配。
- 若直接让 `verify.rs` 调用原 `key()`，**每请求会多一次堆分配**——用性能回退换取去重，
  不可接受。

改为 `Arc<DecodingKey>` 后，`key()` 命中只做一次引用计数递增，与借引用同样廉价。
`insert_key_for_test` 的签名保持不变（内部包装），故基准与测试的调用点无需改动。

### 3. 补上 `key()` 的宽限期覆盖

`key()` 的时间判定此前**零覆盖**：只有 `merge_keys` 的合并期裁剪被测，而查询期判定没有。
既然它现在直接决定"轮换期间旧 key 还能不能用"，必须补测。

为此新增 `insert_key_with_cached_at_for_test(kid, key, cached_at)` ——
默认钩子用真实当前时间，**构造不出过期条目**，这正是该判定长期无覆盖的原因。
原 `insert_key_for_test` 委派给新方法，签名不变。

覆盖 5 例：新鲜条目命中、宽限期内命中、宽限期外视为不存在、未知 kid 返回 None、
以及边界（`now - cached_at == GRACE` 视为过期，因为判定是严格小于）。

### 4. 基准因此自动对准生产路径

`jwks_cache_bench` 无需改动调用——`key()` 现在**就是**生产路径。只更新了文件头注释，
说明 `key(kid)` 是验签路径的必经之处。

## 后果

**收益**
- 宽限期判定从 2 处独立实现收敛为 1 处；改时长/改方向只需改一处。
- 性能基线第一次测到**真实**路径（原先测的是只有基准在用的版本）。
- 生产热路径不增加任何分配（`Arc` 克隆 vs 借用引用，同为常数级）。
- 查询期判定从零覆盖变为 5 例覆盖，含边界。

**代价**
- `JwksKeyEntry.key` 的类型变更影响 4 处（`merge_keys`、`key()`、`insert_key_for_test`、
  测试的 `entry` 助手）——均由编译器定位，无遗漏。
- 公开 API `key()` 的返回类型由 `Option<DecodingKey>` 变为 `Option<Arc<DecodingKey>>`
  （breaking change）。当前唯一外部使用方是本站基准测试，已随之适配。

**未验证**
- **性能数字未实测**：`cargo bench` 在本环境因缺 `cmake`（`libz-ng-sys` 构建脚本）
  无法运行 release 构建。`cargo check --benches` 通过，即基准**可编译且引用正确**，
  但"`Arc` 克隆与借用引用同样廉价"这一论断只有推理支撑，没有测量数据。

## 教训：变异验证必须确认变异真的注入了

本 ADR 落地时做变异验证，第一次把 `key()` 的宽限期判定替换为"恒返回 Some"，
结果测试**全绿**。原因不是测试无效，而是**我的替换串没匹配上**：`rustfmt` 已把
`(now.saturating_sub(...) < JWKS_KEY_GRACE_SECS).then(...)` 折成两行，
而我按一行书写锚点，`str.replace` 静默无操作。

**变异验证本身需要被验证**：注入后应先确认断言锚点匹配成功（本次改为 `assert
old in s`），再解释测试结果。否则会把"变异没生效"误读成"测试捕获不到"，
从而错误地否定一个有效的测试。

## 相关 ADR

- ADR-019: Controller 行数约束（同一纪律：度量/规则必须对准真实目标）
- ADR-020: 审计持久性等级（同一手法：把散落的隐式规则收敛为单一出处）
