# Token 交换的决策表：从零测试到可穷举 —— 以及「Rust 里私有字段不能被兄弟模块读」（#73）

> 日期：2026-10-14
> 来源：**#73**（R12 结构那一半）的验收标准第 2、3、4 条
> 关联 ADR：ADR-009（认证决策唯一）、ADR-010 二期（网关级 OAuth Client）
> 词汇：module / interface / seam / leverage / locality

## 一、问题：300 行 OAuth 编排里，**决策表**藏在需要真 HTTP 服务器的 async fn 里

`oauth_flow.rs` 的 `do_token_exchange` 承载三条业务语义：

| 情形 | 语义 |
|---|---|
| **网络错误**（不可达/超时） | 换下一节点重试 |
| **HTTP 非 2xx**（如 `invalid_grant`） | **确定性拒绝**，立即返回、不重试 |
| 所有节点网络失败 | 502 |

这三条**只写在注释里**，而验证它们需要起一个真实 HTTP 服务器 ⇒ 该函数**零测试**
（本文件整体 0 测试）。纯函数 `parse_token_exchange_response` 同样零测试。

## 二、修法：把决策从 I/O 里剥出来

### 1. 决策表变成**纯函数**

```rust
pub(crate) enum ExchangeAttempt {
    Transport,                       // 传输层失败（不可达 / 超时）
    Status(u16, String),             // 收到响应但非 2xx
    Body(serde_json::Value),         // 2xx 且体已解析
}

pub(crate) enum ExchangeStep {
    RetryNextNode,
    Reject { status: u16, message: String },
    Parsed(TokenExchangeResult),
}

pub(crate) fn decide_exchange(attempt: ExchangeAttempt) -> ExchangeStep
```

决策与 I/O 分开后，三条语义**可以逐条穷举**——这也是唯一能让它们被穷举的办法。

### 2. 纯解析函数返回**消息**，不返回框架错误类型

`parse_token_exchange_response` 由 `Result<_, Error>` 改为 `Result<_, String>`：
消息即拒绝原因，由决策表统一包装成 502。**这使它可被直接断言**（框架 `Error` 无法方便比较）。

### 3. `TokenExchange`：**自持依赖**的执行体

```rust
pub(crate) struct TokenExchange<'a> {
    upstreams: &'a Upstreams,   // ← 它只持自己需要的
    scheme: &'a str,
}
impl TokenExchange<'_> {
    pub(crate) async fn exchange(&self, body: &serde_json::Value) -> Result<TokenExchangeResult>
}
```

装配点在 **`gateway.rs`**：

```rust
impl Gateway {
    pub(crate) fn token_exchange(&self) -> crate::oauth_flow::TokenExchange<'_> {
        TokenExchange::new(&self.oidc_provider_upstream, &self.upstream_scheme)
    }
}
```

## 三、报告里一处**前提错误**（已实测更正）

报告说：「3 个 `pub(crate)` 字段中至少『**仅被 `oauth_flow` 使用**』的两个回到**私有**」。

**Rust 的私有字段不能被兄弟模块读**（可见性以模块为单位）——`oauth_flow.rs` 与 `gateway.rs`
是同级的模块，所以"直接把它们改成私有"会**编译不过**。这不是"没人做"，而是**做不到**。

**真正的解法**（本轮采用）：把**装配点留在能合法读私有字段的模块**，把**自持依赖的结构**交给消费方：

```
gateway.rs（能读私有字段）  ──构造──▶  oauth_flow::TokenExchange（自持 upstreams + scheme）
        ▲                                        │
        └── oidc_provider_upstream / upstream_scheme 因此**可以**是私有 ✓
```

结果：`oidc_provider_upstream` 与 `upstream_scheme` **现在确实是私有字段**（`pub(crate)` 已移除），
验收标准第 2 条达成 ✓ ——**但成事的是"装配点位置"，不是"改可见性"**。

> 这是本会话**第 5 次**因回读代码/语言语义而更正候选描述（R10 `clients`、R12 注释、R13 路径、R17 跨语言、本轮 Rust 可见性）。

## 四、验收标准第 3 条：callback 路径取值收成一处

新增 `Gateway::oauth_callback_path()`（`gateway.rs`）作为**唯一取值口**，
三处调用点（`request_filter` 的路径判定、`/authorize` 阶段、callback 阶段）全部改用它：

```rust
pub(crate) fn oauth_callback_path(&self) -> Arc<str> {
    self.jwks_cache.callback_path_or_default()
}
```

理由（写进文档注释）：OAuth 2.1 要求两阶段 `redirect_uri` **逐字节一致**；
取值散落时"改一处漏一处"就会不一致，而那会直接导致 `invalid_grant`。

## 五、验证

### 新增 11 条单测（`src/oauth_flow/tests.rs`）

覆盖决策表每一格 + 解析函数的边界：传输失败只换节点、非 2xx 保留状态码与响应体、
多种状态码不被折叠、完整响应解析、缺 `id_token` 为 `None`、缺/空 `access_token`、
缺 `refresh_token`、类型不对（数字/null）、非对象 JSON（数组/字符串）不恐慌。

单测总数 **137 → 148**。

### 变异（两条各抓一格）

| 变异 | 结果 |
|---|---|
| **V2**：非 2xx 也去换节点（会掩盖 `invalid_grant`，导致重复 token 交换） | **精确 2 红**：`期望确定性拒绝，实际是 RetryNextNode` |
| **V1**：传输层失败直接拒绝（不再换节点） | **精确 1 红**：`test_transport_failure_retries_next_node` |

还原后 `src/oauth_flow.rs` 哈希 `2e8d4890e29d6a5a…6d4fd9d` 逐字一致。

### 门禁

| 门禁 | 结果 |
|---|---|
| `cargo test --all-features` | **148 passed**（+11）/ 7 doctests |
| `cargo clippy --all-targets --all-features -- -D warnings` | 0 warning |
| `cargo fmt --all -- --check` | 0 diff（**先执行了 `cargo fmt --all`**——初版测试文件有换行差异） |

## 六、仍未完成（本票保留的原因）

验收标准第 1 条「OAuth Client 编排有自持依赖的 module 与显式接口」**只完成了一部分**：
`TokenExchange` 达成了"自持依赖 + 显式接口"，但 `handle_oauth_callback` 与
`oauth_authorize_redirect` 仍是 `impl Gateway` 的方法（带 `&self` 与 `&OAuthConfig` 参数）。

下一步是报告建议的 `intercept(path, query, cookie_header) → CallbackOutcome`：
把 `request_filter` 里的 OAuth 判定分支整体收进 `oauth_flow`，`request_filter` 只负责把
返回值写成响应。**那是一次中等规模重构，且 `request_filter` 目前没有 Session 级测试台**
（R7 遗留），先做它风险更高——留给下一轮，本票保持 OPEN。

## 七、最佳实践（可复用）

1. **决策表要从 async fn 里抽出来才能被穷举。** 只要决策依赖真实 socket，"网络错误换节点 / 非 2xx 确定性拒绝"
   这类关键语义就只能靠注释存在。**抽出纯函数 = 让语义变成可断言的类型**。
2. **纯函数不要返回框架错误类型。** `Result<_, Error>` 让断言变得别扭（框架类型难以比较/构造），
   `Result<_, String>` + 调用方包装，既保住了错误语义又可测。
3. **语言的可见性语义要先确认再定方案。** "把它改成私有"在 Rust 里跨模块**不可能**——
   正确做法是**移动装配点**（把构造留在能读私有字段的模块，把自持依赖的结构交给消费方）。
   这与 TypeScript/Java 的直觉相反，值得写进评审清单。
4. **"唯一取值口"要配一条理由注释。** 本例的理由是 OAuth 2.1 的 `redirect_uri` 逐字节一致——
   没有这条理由，后来者只会看到一个多余的包装方法，然后"顺手"绕开它。
5. **Rust 代码改完必须跑 `cargo fmt --all` 再 `--check`。** 初版测试文件通过 clippy 但有换行差异；
   `--check` 的退出码要**直接取命令的**，不要取管道里 `head` 的（我这次就取错了，误判为通过）。
