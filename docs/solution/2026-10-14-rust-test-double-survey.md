# Rust 侧没有「整体替换式 test double」—— 普查先于立法（#88）

> 日期：2026-10-14
> 来源：**#88**（ADR-022 自述的"Rust 侧另立 effort"）
> 关联 ADR：**ADR-022 第 163 行**（本轮**结案**并修订）、ADR-019
> 词汇：module / interface / seam / leverage / locality

## 一、任务的性质：先把"另立 effort"变成可判定的事

ADR-022 写着一行：

> - Rust 侧同类形态（整体替换式 test double）不在本策略射程，**另立 effort**。

**"另立 effort"是一种债务**：写下它的那一刻就得有人认领。本票的处置是
**先普查、再决定**——而不是直接给 Rust 侧立一条规则（那可能是空转，甚至**逼人们造替身来满足规则**）。

## 二、普查（四种"替身"形状，逐条实测）

```text
grep -rniE "struct (Fake|Mock|Stub|Dummy|Test)[A-Za-z]*|enum (Fake|Mock|Stub)" src/
grep -rn  "impl .* for .*" src/*/tests.rs
grep -rniE "call_count|times_called|assert.*called" src/
grep -rn  "cfg(test)|cfg!(test)" src/ | grep -v "mod tests"
```

| 形状 | 实测 |
|---|---|
| 命名替身（`Fake/Mock/Stub/Dummy` 结构体）| **零命中**（唯二 `TestDir(PathBuf)` 是临时目录 RAII 辅助，非替身） |
| 为**生产 trait** 写的测试实现 | **零命中** |
| 调用计数断言（mock 味）| **零命中** |
| 本地 HTTP 服务器 / 替换 `HTTP_CLIENT` | **零命中** |

**依赖注入的方式是显式的**：`JwtVerifier::new(jwks_cache)`、`JwksCache::new(...)`——
依赖经 `Arc`/参数传入；测试直接构造**真实值**（真实 HMAC 向量、真实 JWS 解析、
真实 PKCE/state 判定）。Rust 的模块系统本身也不提供模块级 mock。

⇒ **那条 effort 没有主体**：Rust 侧不存在"整体替换式 test double"。

## 三、但普查顺带发现了**真正**要看管的东西：测试缝

`#[cfg(test)]` 出现在**生产模块内**（而非 `mod tests` 声明处）的位置，全仓**仅一处**：

```rust
// src/auth/verify.rs
/// 仅供密码学单测使用：隔离 Redis 的 fail-close 行为，验证签名、issuer 与过期判定。
#[cfg(test)]
pub(crate) fn new_without_revocation_for_test(jwks_cache: Arc<JwksCache>) -> Self {
    Self { jwks_cache, check_revocation: false }
}
```

**这类缝能悄悄削弱测试**——"被测语义被替身删掉"正是 ADR-022 要防的形态。
它比 TS 侧的 `vi.mock` 更隐蔽：**它就在生产类型里**，读代码时容易当成普通构造器。

## 四、修法：结案 + 把 TS 侧纪律移植过来

### 1. 修订 ADR-022（不留无人认领的承诺）

把那一行改为**结案声明**：普查结论 + **可复跑的方法** + 顺带发现 + 新守卫。
（原文用删除线保留，读者能看到"曾有此承诺、现已结案"。）

### 2. 新增守卫 `apps/gateway/src/test_hygiene_tests.rs`

与 TS 侧的 `@allow-module-mock` 同构：**生产模块内每个测试缝都必须在
`DECLARED_SEAMS` 里登记并写明理由**。

- 扫描 `src/**/*.rs`，判定"`#[cfg(test)]` 之后不是 `mod <任意名>`"的位置；
- **正向**：未登记 ⇒ 失败（消息点名 `文件 :: 条目` 并给出处置建议）；
- **反向**：登记了但已不存在 ⇒ **也失败**（否则登记表会腐烂）；
- **解析器自测**：断言扫描器能识别已知的那一处缝（防止"扫描器失灵 ⇒ 守卫永远通过"）。

### 3. 变异验证（守卫不是摆设）

| 变异 | 结果 |
|---|---|
| **Z**：在 `src/jwks.rs` 新增一个未登记的测试缝 `new_without_network_for_test` | **精确变红**：`src/jwks.rs :: new_without_network_for_test`（并给出处置建议） |

还原后 `src/jwks.rs` 哈希 `71f69fe4fd0baeaf…2e9b02` 逐字一致 ✓。

> 顺带：我的**第一版扫描器有两个 bug**（把 `mod contract_tests;` 误判为缝、条目名取成关键字 `fn`），
> 是**解析器自测**把它们当场抓出来的——这正是自测存在的理由。

## 五、门禁

| 门禁 | 结果 |
|---|---|
| `cargo test --all-features` | **168 passed**（166 → +2 卫生守卫）/ 7 doctests |
| `cargo clippy --all-targets --all-features -- -D warnings` | 0 warning |
| `cargo fmt --all -- --check` | 0 diff |

## 六、最佳实践（可复用）

1. **"另立 effort" 必须有人认领。** 文档里每一句"以后再做"，都应转换为**可判定的事**：
   要么普查后结案（附方法与证据），要么立案。
2. **普查先于立法。** 若 Rust 侧本就没有该形态，直接立法会空转——**甚至逼人们造出替身来满足规则**。
3. **普查的价值常在"顺带发现"。** 真正要看管的是**测试缝**；把 TS 侧"替身必须带理由"的
   纪律平移过来，比硬套 TS 的形态更贴合语言。
4. **守卫要双向。** 未登记要报，**登记了但已删除也要报**——否则允许清单会变成垃圾场
   （与"孤儿注解"同类，TS 侧 `module-mock-guard` 也检查这一点）。
5. **解析器/扫描器必须有自测。** 一个失灵的扫描器会让守卫"永远通过"；
   本轮第一版就因两个解析 bug 被自测挡下。
