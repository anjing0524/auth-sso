# OAuth 安全判定要有测试面 —— 顺带消灭一条「三方同步」约定（架构评审 R2 候选 R12 · 第一半）

> 日期：2026-10-13
> 来源：improve-codebase-architecture 架构评审第二轮（Worth exploring 候选 R12）
> 关联 ADR：ADR-009（Gateway 认证流）、ADR-013；R8 建立的跨语言契约工件
> 词汇：module / interface / seam / leverage / locality（codebase-design）

## 一、问题总结（三件，都可证实）

### 1. 两个安全判定内联在 260 行编排里，**零测试**

`oauth_flow::handle_oauth_callback` 内联了两处安全判定：

```rust
// CSRF state（原 :173-180）
if cookie_state != Some(state_param) { ... }

// nonce 双向 fail-close（原 :219-231）
let nonce_ok = match (cookie_nonce, id_nonce) {
    (Some(c), Some(i)) => c == i,
    (None, None) => true,
    _ => false,
};
```

而 `oauth_flow.rs` 整文件测试数为 **0**（它需要 Pingora `Session`，判定因此永远无法被直测）。
`oauth.rs` 的 10 个测试只覆盖 PKCE / Cookie 拼装 / `safe_redirect_path`。

### 2. callback 路径靠**注释**要求"三方同步"

`jwks.rs` 原文：

```rust
.unwrap_or_else(|| Arc::from("/api/auth/callback"))
// ↑ 兜底值与 Portal Discovery `com_authsso_callback_path` 声明值
// 及 Portal callback 路由路径保持一致；变更时需三方同步
```

三个地方（Portal Discovery 的字面量、Gateway 的兜底默认值、Gateway 的拦截判定）靠一句注释
维系一致。**改 Portal 声明而不改 Gateway 兜底 ⇒ Gateway 在 Discovery 未就绪时拦截错误的路径，
而没有任何测试会变红。**

### 3. 注释指向一个**已被删除**的文件

`oauth.rs` 原文写：

```rust
// ── OAuth 2.1 Client Cookie 名称（必须与 Portal /callback/route.ts 完全一致）──
```

Portal 的 `/callback/route.ts` 已于 **2026-09-30 移除**（glossary 有记录）——callback 拦截
迁到了 Gateway，那四个临时 Cookie 由 Gateway 自己下发、自己读回。
实测：全仓 grep `COOKIE_NAMES.{PKCE_VERIFIER,OAUTH_STATE,OAUTH_NONCE,RETURN_TO}` 与四个字面量，
在 `apps/portal` / `apps/demo-app` 侧**零引用**。

> **连带更正我自己上一轮的记录**：R8 把这四个名字纳入跨语言工件时，理由写的是
> "一侧写、另一侧读"。实际是"contracts 声明 + Gateway 独占消费"。**约束本身仍有价值**
> （防 contracts↔Gateway 漂移），但**理由必须说准**——否则下一位读者会去 Portal 找消费方。

## 二、修复方案

### 1. 两个判定提取为纯函数（`oauth.rs`）

```rust
pub fn state_matches(cookie_state: Option<&str>, query_state: &str) -> bool
pub fn nonce_matches(cookie_nonce: Option<&str>, id_token_nonce: Option<&str>) -> bool
```

`oauth_flow.rs` 改为调用它们，判定因此进入 `oauth.rs` 的测试面。

**并收紧一个 fail-open 边缘**：原式 `cookie_state == Some(state_param)` 会放行
`Some("") == ""`——两侧都是空串时 CSRF 检查通过。CSRF token 不存在合法空值
（`/authorize` 下发的 state 恒为 CSPRNG 非空值），故判据加**非空前提**。
不可利用（攻击者无法在 Gateway 域上设置 Cookie），但没必要留一个"空令牌算通过"的口子。

### 2. callback 路径进入 contracts，两端对同一工件断言

- `contracts`：`OAUTH_CALLBACK_PATH = '/api/auth/callback'`（单点持有）
- Portal Discovery 路由：改用该常量（原先内联字面量）
- Gateway `jwks.rs`：兜底默认值提取为 `pub(crate) const DEFAULT_CALLBACK_PATH`
- 工件 `cross-language-fixture.json`：新增 `discoveryFields.callbackPath`
- **两端各一条断言**（TS `OAUTH_CALLBACK_PATH` / Rust `DEFAULT_CALLBACK_PATH` == 工件值）

⇒ "变更时需三方同步"这句注释删除，改由测试强制（**这才是 R8 那套工件的正当用法**）。

### 3. 更正两处文档理由

`oauth.rs` 的 Cookie 名称注释（改为"读写都在 Gateway 侧；与 contracts 对齐是为防漂移"）；
R8 的 TS 测试把"纳入"分成两类（一侧写另一侧读 / contracts 声明 + 单一实现方消费），
并写明这四条的归属。

## 三、同类普查

| 检查项 | 结论 |
|---|---|
| 那 4 个临时 Cookie 在 Portal / demo-app 的引用 | **0 处**（全仓 grep）⇒ Gateway 内部值，注释更正有据 |
| `oauth_flow.rs` 里其它内联判定 | 本次提取的 state / nonce 是仅有的两处安全判定；其余是 URL/Cookie 构造（已在 `oauth.rs`） |
| 其它 callback 路径取值点 | 3 处（`gateway.rs:456`、`oauth_flow.rs:49`、`:193`），都经 `callback_path_or_default()` —— 单一取值口已存在，缺的只是**值**的一致性 |

## 四、验证

### 变异（两个，各自精确）

| 变异 | 结果 |
|---|---|
| G：`state_matches` 退回修复前的 fail-open 比对（`cookie_state == Some(query_state)`） | `oauth::tests::state_matches_is_fail_close` **唯一变红** |
| H：`DEFAULT_CALLBACK_PATH` 改成 `/api/auth/cb`（兜底值漂移） | `contract_tests::oauth_callback_path_matches_fixture` **唯一变红** |

两次合计 **2 红 / 135 绿**，无附带影响——证明两条断言各自承重。
还原后哈希逐字一致（`a5867a303898970d…8b97c7` / `71f69fe4fd0baeaf…2e9b02`）。

### 门禁

| 门禁 | 结果 |
|---|---|
| `cargo test --all-features` | **137 通过**（134 → +2 判定 +1 契约）+ 7 doctest |
| `cargo clippy --all-targets --all-features -- -D warnings` | 0 警告 |
| `cargo fmt --all -- --check` | 通过 |
| `pnpm test` | **90 文件 / 748 用例全绿**（+1 契约断言） |
| `tsc`（portal / contracts） | 0 错误 |

## 五、最佳实践（可复用）

1. **需要 Pingora `Session` 的模块里，安全判定永远测不到。** 判据很简单：
   **"这个判定我能不能喂两个值就测"** ——不能，就说明它内联错了位置。
   把它提成纯函数是"给安全判定一个测试面"的最低成本做法。
2. **fail-close 要审到"空值"这一格。** `Some("") == ""` 看起来无害，但它是
   "空令牌算通过"。写判定的真值表时，**空串必须单独占一行**。
3. **注释里的"需 N 方同步"是一个待还的技术债标记。** 它承认了一致性只靠人。
   把它换成"工件 + 两端断言"就变成机器强制——**这句话出现的地方就是该上契约的地方**。
4. **引用文件名的注释会腐烂。** `必须与 Portal /callback/route.ts 一致` 在该路由删除后
   变成谎话，且它会让读者去一个不存在的地方找消费方。**引用文件路径的注释应带日期或改为职责描述。**
5. **上一轮的记录也要按新证据更正。** R8 把这四个 Cookie 写成"跨语言"，R12 的证据表明
   Portal 侧已无消费方——**保留约束、更正理由**，并在两处都写明更正日期与依据。
