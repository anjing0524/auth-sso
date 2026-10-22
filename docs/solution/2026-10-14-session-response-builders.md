# Session 响应构造器：从零测试到纯函数直测（#85）—— 以及「锚点不唯一」的一次教训

> 日期：2026-10-14
> 来源：**#85**（R7 遗留的测试面缺口；同时是 **#73 验收标准 1** 的阻塞项）
> 关联 ADR：ADR-009（认证决策唯一）、#64（续签轮换被坍缩的缺陷）
> 词汇：module / interface / seam / leverage / locality

## 一、问题：4 个响应构造器零测试，而它们是**安全下发面**

`src/http.rs` 的 `trait SessionExt` 有 4 个响应构造器，**全部没有测试**；
该文件的 `#[cfg(test)] mod tests` 只覆盖 HMAC 校验向量。

| 方法 | 调用点 | 漏一条的后果 |
|---|---|---|
| `respond_401` | 认证失败 | — |
| `respond_401_with_cookies` | `authenticate.rs:110` | **清除 Cookie 漏一条 = 登出后仍持有效会话** |
| `respond_302_with_cookies` | `gateway.rs:486`、`oauth_flow.rs:195/228/312` | **漏 `extra_cookies` = 浏览器继续用已被 Portal 撤销的旧 RT**（#64 的家族级联撤销正是这么发生的） |
| `respond_429` | 限流 | `Retry-After` 丢失 → 客户端重试风暴 |

根本原因：`Session` 需要真实连接才能实例化 ⇒ 这些构造器**只能靠集成测试**，而它们没有。
**症状在正常路径下看不出来**：响应码与 `Location` 都对，只有 **Cookie 头的内容**错了。

## 二、修法：把「头构造」抽成纯函数

```rust
pub(crate) fn build_401_headers(cookies: &[String]) -> Result<ResponseHeader>
pub(crate) fn build_302_headers(location: &str, cookies: &[String]) -> Result<ResponseHeader>
pub(crate) fn build_429_headers(retry_after_secs: u64) -> Result<ResponseHeader>
```

`ResponseHeader` 是**普通结构体**，不需要 `Session` 就能构造与读取 ⇒ 可直测 ✓。

`SessionExt` 退化为薄写入层：

```rust
async fn respond_302_with_cookies(&mut self, location: &str, cookies: &[String]) -> Result<()> {
    let header = build_302_headers(location, cookies)?;
    self.set_keepalive(None);            // Session 级副作用留在 impl
    self.write_response_header(Box::new(header), true).await
}
```

### 为什么选"抽纯函数"而不是"造一个可注入的 Session 测试台"

后者需要构造 Pingora 的 `Session`（例如基于 `tokio::io::duplex` 的内存连接），成本明显更高，
且 `Session` 的构造未必开放。而**抽纯函数能覆盖全部有语义的东西**（状态码、`Location`、
`Set-Cookie` 及其顺序、`Retry-After`），只剩 `write_response_header` 这一句 I/O 壳——
与 #73 的 `decide_exchange` 是同一手法：**决策/构造与 I/O 分开**。

## 三、被固定住的一条**顺序语义**

```rust
header.append_header("Set-Cookie", cookie.as_str())?;   // 必须 append，不能 insert
```

**同名 `Set-Cookie` 出现多次时后者生效**（RFC 6265 §5.2）⇒
「先下新会话 Cookie、再下清除 Cookie」这个**先后**是语义的一部分，不能重排、不能覆盖。
`oauth_flow.rs` 的 `[session_cookies, clear_cookies].concat()` 正是依赖它。

## 四、验证

### 新增 6 条单测（单测总数 148 → **154**）

401（`Bearer` + 逐条 Cookie 保序 / 无 Cookie 时不产生 Set-Cookie）、
302（`Location` + 保序 / 无 Cookie）、429（`Retry-After` 十进制，含 `0`）、
**同名 Cookie 必须 `append` 而非 `insert`**。

### 变异（两条各抓一处）

| 变异 | 结果 |
|---|---|
| **W1**：`build_302_headers` 把 `Set-Cookie` 的 `append_header` 改成 `insert_header` | **精确 2 红**（含"同名 Cookie 保序"用例） |
| **W2**：`build_401_headers` 去掉 `WWW-Authenticate: Bearer` | **精确 1 红** |

还原后 `src/http.rs` 哈希 `136ee94d08655daf…c9c4072` **逐字一致**。

### 门禁

| 门禁 | 结果 |
|---|---|
| `cargo test --all-features` | **154 passed**（+6）/ 7 doctests |
| `cargo clippy --all-targets --all-features -- -D warnings` | 0 warning |
| `cargo fmt --all -- --check` | 0 diff |

## 五、一次真实的流程教训：**锚点不唯一，哈希救了我**

还原 W1 时我的脚本用了 `for cookie in cookies { … }` 这段文本作锚点——但它在
`build_401_headers` 与 `build_302_headers` **两处都存在**。于是"还原"实际上匹配到了
**401** 的循环，把 `WWW-Authenticate` 那一行**删掉了**，等于**顺手把 W2 也注入了**；
下一次脚本想注入 W2 时锚点已不存在，直接抛断言失败。

**是哈希校验把这件事揭出来的**：还原后应等于 `136ee94d…`，实际是 `37cf75a0…` ⇒ 立刻发现不符。

两条纪律由此再次被证实：

1. **变异还原的锚点必须含唯一上下文**（本例应带上 `ResponseHeader::build(302, …)` 那一行或函数头），
   否则会改到同名兄弟分支——**这与 R11 的"守卫自身写错"、R9 的"还原脚本失效"是同一类问题**；
2. **还原后必须核对哈希**（本会话第 6 次靠它发现还原不实）。没有哈希这一步，我就会带着
   "W1 已还原"的错误结论继续往下走，最终把删掉 `WWW-Authenticate` 的代码提交上去。

## 六、效果：解锁 #73 的收尾

#73 的验收标准 1（把 `request_filter` 的 OAuth 判定分支收进
`oauth_flow::intercept(...) → CallbackOutcome`）此前**无法验证**——因为搬家会大量改动这些
响应构造的调用点，而这层没有测试。#85 完成后，`302`/`401` 的**头内容**有了直测，
#73 的收尾可以先钉住"搬家前后头内容不变"再做。

## 七、最佳实践（可复用）

1. **需要真实连接才能实例化的方法，先把"值构造"抽出来。** 剩下的 I/O 壳（一句 `write_response_header`）
   不覆盖也远好过整块零覆盖。**判断标准：抽出来的部分是否包含全部语义。**
2. **顺序也是契约。** 同名 `Set-Cookie` 后者生效、清除 Cookie 必须在会话 Cookie 之后——
   这类顺序**没有类型能表达**，只能靠测试钉住（`append` vs `insert` 只是一个字符之差）。
3. **纯构造函数不要把 Session 级副作用带进来。** `set_keepalive(None)` 留在 impl ——
   纯函数只负责"返回应该长什么样的头"。
4. **变异还原的锚点要唯一，且还原后核对哈希。** 本轮锚点撞车导致误删一行，哈希把它抓住；
   否则错误会静静地进入提交。
