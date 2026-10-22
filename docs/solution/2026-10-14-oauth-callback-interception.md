# OAuth callback 的拦截判定与校验序列：从内联到纯函数（#73 标准 1，收尾）

> 日期：2026-10-14
> 来源：**#73** 验收标准 1「OAuth Client 编排有自持依赖的 module 与显式接口」
> 关联 ADR：**ADR-009**（认证决策唯一）、ADR-010 二期、RFC 6749 §4.1.2.1 / §4.1
> 词汇：module / interface / seam / leverage / locality

## 一、问题：两条**安全判定**内联在 Session 绑定的代码里，因此零测试

| 判定 | 原先位置 | 覆盖 |
|---|---|---|
| callback 路径命中规则（精确 or 后跟 `/`） | `gateway.rs::request_filter` 内联 | **0** |
| `error=` 与 `code`/`state` 的**优先级** | 同上 | **0** |
| `code` 与 `state` 缺一不可 | 同上 | **0** |
| 校验序列：Cookie → state → PKCE | `handle_oauth_callback`（`&mut Session`） | **0** |
| `return_to` 的开放重定向防护 | 同上（`safe_redirect_path` 本身有测试，但**回落行为**没有） | 0 |

判定内联在需要 `&mut Session` 的方法里 ⇒ 只能靠集成测试，而它们不存在。

## 二、修法：两个纯函数 + 一个契约常量

```rust
// 拦截判定（零 I/O）
pub(crate) enum CallbackOutcome { NotIntercepted, Denied, Handle { code: String, state: String } }
pub(crate) fn intercept(path: &str, query: &str, callback_path: &str) -> CallbackOutcome

// 校验序列（零 I/O）
pub(crate) enum CallbackCheck {
    RedirectToLogin { reason: &'static str },
    Proceed { verifier: String, nonce: Option<String>, return_to: String },
}
pub(crate) fn check_callback(cookie_header: Option<&str>, state_param: &str) -> CallbackCheck

pub(crate) const CALLBACK_DENIED_LOCATION: &str = "/login?error=oauth_denied";
```

`request_filter` 与 `handle_oauth_callback` 退化为**执行者**：
`match intercept(...) { NotIntercepted => {}, Denied => 302, Handle{..} => 执行流程 }`。

`query_param` 放宽为 `pub(crate)`（`oauth_flow` 需要同一套参数提取；
**理由写进注释**：避免两处实现漂移）。这是本轮唯一的可见性放宽，且是为了**消除重复实现**而非图方便。

## 三、被测试钉住的五条语义（每条都有"为什么"）

1. **路径必须精确匹配，或其后紧跟 `/`**：裸前缀匹配会放行 `/api/auth/callback.evil`
   这类路径——**变异 X1**（退回 `starts_with`）精确打红该用例。
2. **`error=` 优先于 `code`/`state`**：RFC 6749 §4.1.2.1 的错误响应**不带 code**，
   走 code 校验路径只会产生误导性的"缺 code"日志。
3. **`code` 与 `state` 缺一不可**：只带一半参数不得进入流程（换 token 必然失败，还白耗一次 state 校验）。
4. **state 校验先于 PKCE 校验**：反过来会让 CSRF 失败被"缺 verifier"掩盖——
   **变异 X3**（对调两段）精确打红 `..._state_mismatch_precedes_missing_verifier`。
5. **`return_to` 必须过 `safe_redirect_path`**：测试用三个 payload 钉住回落行为——
   `https://evil.example.com/`、`//evil.example.com`（协议相对）、`javascript:alert(1)`，
   全部必须回落到 `/`。

## 四、验证

### 新增 12 条单测（单测总数 154 → **166**）

`intercept`：非 callback、精确/带 `/` 命中、**裸前缀负例**、code+state 齐全、缺一、
`error` 优先、契约常量值。`check_callback`：无 Cookie、state 不匹配**优先于**缺 verifier、
state 匹配但缺 verifier、齐全时透传（含 nonce 与 return_to）、默认回落 `/`、三种开放重定向 payload。

### 变异（两条各抓一处）

| 变异 | 结果 |
|---|---|
| **X1**：路径判定退回裸前缀匹配 | **精确 1 红**（`test_intercept_requires_exact_path_or_separator`） |
| **X3**：把 PKCE 检查提到 state 之前 | **精确 1 红**（`test_check_callback_state_mismatch_precedes_missing_verifier`） |

还原后 `src/oauth_flow.rs` 哈希 `8b3f5a6c6afc444c…b98da3bf` **逐字一致**
（本轮吸取 #85 的教训：锚点带**函数头**，确保唯一）。

### 门禁

| 门禁 | 结果 |
|---|---|
| `cargo test --all-features` | **166 passed**（+12）/ 7 doctests |
| `cargo clippy --all-targets --all-features -- -D warnings` | 0 warning |
| `cargo fmt --all -- --check` | 0 diff |

## 五、#73 的验收标准至此全部满足

| 标准 | 状态 |
|---|---|
| 1. 自持依赖的 module 与显式接口 | ✅ `TokenExchange`（自持 upstreams/scheme）+ `intercept` / `check_callback`（纯接口） |
| 2. 仅被 oauth_flow 使用的两个字段回私有 | ✅ 已私有（靠**移动装配点**，非改可见性） |
| 3. callback 路径取值收成一处 | ✅ `Gateway::oauth_callback_path()` |
| 4. `do_token_exchange` 决策表有测试 | ✅ 11 条 |
| 5. clippy / fmt / cargo test 全绿 | ✅ |

## 六、最佳实践（可复用）

1. **判定内联在 `&mut Session` 方法里 = 判定不可测。** 本轮是本会话**第三次**用同一手法解决它
   （`decide_exchange` → `build_*_headers` → `intercept`/`check_callback`）：
   **把"决定做什么"抽成纯函数，"把决定写出去"留在 I/O 层。**
2. **顺序语义必须由测试钉住，因为类型表达不了它。** state 先于 PKCE、`error` 先于 `code`——
   这类顺序一旦被"顺手重排"，行为变化**不会**被编译器或现有测试发现（两个变异都证明：
   只有专门写的顺序用例才会红）。
3. **路径前缀匹配必须要求分隔符。** `/cb` 与 `/cb.evil` 的区别是安全问题，
   不是风格问题——**负例测试（`/cbXYZ` 不得命中）比正例更重要**。
4. **开放重定向要用 payload 集合钉住回落。** 只测"绝对 URL"会漏掉协议相对（`//evil`）与
   `javascript:` 两种——它们的绕过方式不同。
5. **可见性放宽要带理由。** 本轮 `query_param` 改 `pub(crate)` 的唯一理由是**避免第二套参数解析**；
   没有这条理由，放宽可见性就是架构污染。
