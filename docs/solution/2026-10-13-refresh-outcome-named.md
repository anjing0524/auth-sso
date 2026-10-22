# 续签结果必须有名字 —— 「已轮换」是不可逆事实（架构评审 R2 候选 R7）

> 日期：2026-10-13
> 来源：improve-codebase-architecture 架构评审第二轮（Strong 候选 R7，报告 `.arch-review/architecture-review-20261013-100205.html`）
> 关联 ADR：**ADR-009**（Gateway 认证流统一，本次修订其决策 5 的示例）、ADR-012（RT 绑定 client / 家族撤销）、ADR-013（per-client aud）
> 词汇：module / interface / seam / leverage / locality（codebase-design）

## 一、问题总结

`TokenRefresher::try_refresh` 的公开签名为 `-> Option<RefreshedTokens>`，把**四种语义完全不同**
的情况压成同一个 `None`：

| 情况 | 旧返回 | 真实语义 |
|---|---|---|
| Portal 已轮换 | `Some` | **旧 RT 此刻已在 Portal 侧被撤销**；新 token 必须送达浏览器 |
| Portal 判定无需续签 | `None` | AT 仍新，什么都没发生 |
| 30s 去重命中 | `None` | 另一个请求正在续签 |
| 全部端点失败 | `None` | 续签没成功 |

而调用侧的 `try_refresh_session() -> bool` 又坍缩了第二次，把「拿不到新 token」的**六种**原因
（含"无 RT Cookie""无身份""新 AT payload 解不开"）压成 `false`。

### 真实缺陷：解不开 payload 时，新 Cookie 被整体丢弃

`authenticate.rs` 里原本是：

```rust
let Some(new_tokens) = refresher.try_refresh(rt, &identity.user_id).await else { return false; };
let Some(new_claims) = decode_jwt_payload(&new_tokens.access) else { return false; };  // ← 这里
ctx.refreshed_tokens = Some(new_tokens);   // 因此不执行
```

第 4 行 `return false` 时，**Portal 早已在同一个已提交事务里撤销了旧 RT 并写入了新 RT**。于是：

1. `ctx.refreshed_tokens` 保持 `None` → `response_filter` 不下发任何 Set-Cookie
2. 浏览器继续持有**已被 Portal 撤销的旧 RT**
3. 下次请求触发续签 → Portal 的**复用检测**命中 → **家族级联撤销**
   （`(userId, clientId)` 家族的**全部** RT 一起失效——包括该用户其他正常会话）

一次"新 AT 解不开"的边缘情况，代价是用户被登出，且波及其他会话。

### 为什么测试没抓到

`authenticate.rs` 当时只有一个纯函数测试（`refresh_failure_blocks` 的 6 条真值表），
它测的正是**坍缩之后的那一位**；而 `try_refresh_session` 整条路径（含 Cookie 是否被记入
`ctx`）没有测试——因为它需要 Pingora `Session`。

## 二、修复方案

### 1. 给「已轮换」一个名字

```rust
pub enum RefreshOutcome {
    /// Portal 已轮换：新 token 对可用。调用方**必须**把新 Cookie 送达浏览器，
    /// 无论本次请求最终是放行还是被阻断。
    Rotated(RefreshedTokens),
    Skipped,   // Portal 判定无需续签
    Deduped,   // 30s 去重窗口内已有续签在进行/刚完成
    Failed,    // 已尝试且全部端点失败（或无可用端点）
}
```

### 2. 用纯转移函数把不变量写进类型

```rust
struct RefreshEffect {
    identity: Option<Identity>,          // 新身份（payload 可解码时）
    tokens: Option<RefreshedTokens>,     // **仅**在 Portal 已轮换时为 Some
    block: bool,
}
fn refresh_effect(expiry: &TokenExpiry, outcome: Option<RefreshOutcome>) -> RefreshEffect
```

- `outcome: None` = **未尝试**（缺 RT Cookie / 缺身份）。它的影响与 `Failed` 相同，但两者是
  不同的事实（"没有可续签的前提" vs "续签失败"），故不压成一个值。
- `Rotated` ⇒ `tokens` 恒为 `Some`（与 payload 是否可解码、是否阻断**无关**）。
- 解不出新身份时：`NearlyExpired` 用旧 AT 继续本次请求（旧 AT 仍有效）；`Expired` 必须阻断
  （旧 AT 已过期，转发上游只会换来 401）——**两种情况新 Cookie 都要下发**。

### 3. 三个终局路径都要能送达

| 路径 | 下发方式 |
|---|---|
| 放行（`Pass`） | `response_filter` 读 `ctx.refreshed_tokens`（原有） |
| 阻断 401（`Interrupted`） | **新增** `SessionExt::respond_401_with_cookies` |
| HTML 导航重登（`PkceRequired`） | **新增** `oauth_authorize_redirect(..., extra_cookies)` 把会话 Cookie 附在同一个 302 上 |

这是本候选**唯一**需要在三处下发的原因：Pingora 的 `response_filter` 只对**被代理的**请求运行，
本地直接生成的 401/302 不会经过它——不变量要求"必然送达"，就必须在每个终局显式带上。

## 三、同类普查（本仓纪律）

普查 Gateway 全部 `-> bool` / `-> Option<…>` 返回的函数：

| 类别 | 例 | 判定 |
|---|---|---|
| 纯谓词 | `is_html_page_navigation`、`is_identity_header`、`is_valid_dns_name`、`is_empty` | **单义**，不动 |
| 纯查找 | `extract_from_header`、`cookie_value`、`query_param`、`response_for_path`、`header_str` | **单义**（找到/没找到），不动 |
| 生命周期等待 | `wait_for_http_listener`、`wait_or_shutdown` | ACME 生命周期，非认证路径，不在本候选范围 |
| **续签结果** | `try_refresh`（原 `Option<RefreshedTokens>`） | **多义，本轮修复** |
| 未尝试/已尝试 | `try_refresh_session -> Option<RefreshOutcome>`（本轮新增） | 单轴（尝试与否），文档写明 |

**结论**：认证路径上唯一的多义坍缩就是 `try_refresh`；其余 `bool`/`Option` 都是单义谓词或查找。
ADR-009 当年已把 `Result<bool>` 改为 `AuthDecision` 三态，本轮是同一纪律在**下一层**的补齐。

## 四、验证

### 变异验证

把修复前的行为注回（`Rotated` 且 payload 解不出时 `tokens = None`）：

```
test authenticate::tests::rotated_always_delivers_tokens ... FAILED
test result: FAILED. 127 passed; 1 failed
```

**只有那一条不变量测试变红**——它存在的唯一目的就是钉住"已轮换 ⇒ 新 Cookie 必达"。
其余 127 条（含 `rotated_with_undecodable_payload_blocks_only_when_expired` 等）保持绿，
说明决策表其余部分未被误伤。变异前后哈希 `e838aa65ffc71ff7…6de643` 逐字一致。

### 门禁

| 门禁 | 结果 |
|---|---|
| `cargo clippy --all-targets --all-features -- -D warnings` | 0 警告 |
| `cargo fmt --all -- --check` | 通过（首次有一处差异，已 `cargo fmt`） |
| `cargo test --all-features` | **128 通过 / 0 失败**（新增 5 条纯函数测试）+ 7 doctest 通过 |

### 覆盖缺口（如实记录）

`respond_401_with_cookies` 与 302 的 `extra_cookies` 是**响应写出**，需要 Pingora `Session`；
本仓 Gateway 没有 `tests/` 集成测试台（单元测试都在模块内），`Docker 发布旅程` E2E 只覆盖
登录/登出的正常路径。**因此"阻断时新 Cookie 是否真的出现在响应头里"目前没有自动化断言**——
本轮只保证 `ctx.refreshed_tokens` 一定被写入（纯函数层已钉），以及三处下发的代码路径存在。
把它补齐需要一个 Session 级测试替身，属下一轮的候选（已记在本文件与 roadmap）。

## 五、最佳实践（可复用）

1. **"不可逆的外部事实"必须在返回值里有名字。** Portal 一旦轮换，旧 RT 就没了——这是**不可逆**的；
   把它与"什么都没发生"压进同一个 `None`，等于让调用方无法知道"我已经欠浏览器一个新 Cookie"。
   判据：**问自己"这个分支之后，世界和之前一样吗？"** 不一样就必须有独立的名字。
2. **不变量写成类型，而不是写成注释。** `RefreshEffect.tokens` 的 `Some` 只在 `Rotated` 出现，
   测试可以直接断言"所有 Rotated 情况下 tokens 都是 Some"——注释做不到这一点。
3. **框架只在某些路径调用你的钩子时，要数清"终局路径"有几条。** `response_filter` 只对代理请求
   运行；本地生成的 401/302 是另外两条。**"必然送达"要求逐条覆盖**，否则不变量只是纸面的。
4. **纯函数抽取的真正价值是让决策表可穷举，而不是"方便测试"。** 本例的 `refresh_effect`
   让三种到期状态 × 五种续签结果的全部组合可被逐格断言，且变异时能精确指出是哪一格失守。
5. **测试面也有覆盖不到的地方，要写下来。** 响应写出路径缺 Session 级测试是事实，
   写进文档比留一个"看起来全覆盖"的印象安全。
