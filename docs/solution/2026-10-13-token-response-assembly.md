# token 族的响应形状只有一个组装点 —— 并补上协议漏回报的 `scope`（架构评审 R2 次级候选）

> 日期：2026-10-13
> 来源：improve-codebase-architecture 架构评审第二轮（次级候选「token 签发族统一返回形状」）
> 关联 ADR：ADR-011（故障语义分级）、ADR-018（权限上下文分级）
> 词汇：module / interface / implementation / seam / leverage / locality

## 一、问题总结

同一 token 族的两个分支有**两种领域形状**，而**协议响应被路由手拼**：

| 分支 | 领域形状 | 响应组装 |
|---|---|---|
| 授权码兑换 | `OAuthTokenResponse`（协议形状，snake_case） | 在 `lib/auth/oauth-grant` 内产出 ✓ |
| RT 轮换 | `RefreshTokenResult`（camelCase：`accessToken`/`refreshToken`/`expiresIn`） | **路由手拼** |

`/api/auth/oauth2/token` 的 refresh 分支手写：

```ts
return NextResponse.json({
  access_token: result.accessToken,
  token_type: 'Bearer',
  expires_in: result.expiresIn,
  refresh_token: result.refreshToken,
});     // ← 没有 scope
```

### 缺陷：`scope` 未回报（RFC 6749 §5.1）

而**授权码分支一直带 `scope`**（`oauth-grant.ts:192`：`scope: authCode.scope`）——
同一个端点的两个 grant 分支，字段集不一致。

根因不是"忘了写"：轮换当时**手里就有 `rt.scopes`**（`signAccessToken(..., rt.scopes)` 用的就是它），
只是 `RefreshTokenResult` **没有把它返回**⇒ 路由即便想写也没有数据。

红测试原样输出：

```
AssertionError: expected undefined to be 'openid profile email offline_access'
```

### 附带：Cookie 清除侧的属性策略与写入侧不一致

`cookies.set` 有 4 处**写入**、3 处**清除**，各自手写属性。写入侧一致
（`path`/`httpOnly`/`secure`/`sameSite`/`maxAge`），而**清除侧 3 处里只有 1 处带 `secure`**
（`oauth-utils.ts` 有，`logout/route.ts` 与 `refresh/route.ts` 没有）。

RFC 6265bis 的 cookie protection 下，**非 Secure 的清除 Cookie 无法覆盖 Secure 的同名 Cookie**
⇒ 当 `COOKIE_SECURE=true` 而请求未被判定为安全（例如 TLS 在别处终结）时，**登出清不掉会话 Cookie**。

### 报告里一处不准确（已实测更正）

报告称"跨语言证据：`gateway/auth/refresh.rs:25` 与 `oauth_flow.rs:234-258` 对**同一动作**消费两套字段名"。
实测：那是**两个不同端点**——

| Gateway 解析器 | 端点 | 字段名 | 性质 |
|---|---|---|---|
| `auth/refresh.rs` `TokenRefreshJsonResponse` | `/api/auth/refresh`（内部静默续签） | camelCase（`accessToken`…） | 内部 API，**故意**与协议不同 |
| `oauth_flow.rs` `parse_token_exchange_response` | `/api/auth/oauth2/token`（RFC 令牌端点） | snake_case（`access_token`…） | RFC 6749 §5.1 协议 |

两者契约本就该不同（一个内部、一个协议），且 `refresh.rs` 的注释明说"未知字段（如 `expiresIn`）
由 serde 默认忽略"。⇒ **此处不是缺陷**，不需要"统一字段名"。

## 二、修复方案

### 1. `RefreshTokenResult` 补 `scope`（必填）

轮换手里就有 `rt.scopes`，把它返回；**必填**而非可选——缺席正是本次缺陷。

### 2. 新增唯一的协议响应组装点

`domain/auth/token-response.ts`：

```ts
export function toOAuthTokenResponse(input: TokenResponseInput): OAuthTokenResponse
// input.scope 必填 → "漏回报 scope" 在结构上不再可能
```

`token/route.ts` 的 refresh 分支改为 `NextResponse.json(toOAuthTokenResponse(result))`。

**如实说明残留**：授权码分支仍在 `oauth-grant` 内直接产出 `OAuthTokenResponse`
（它本就是协议的实现方）。所以准确的说法是"**路由不再手拼**、每族各有一个产出点"，
而不是"全局只有一个"。两侧形状一致性由端点级测试钉住（该分支的 `scope` 一直存在）。

### 3. 清除侧属性与写入侧对齐

`logout/route.ts`、`refresh/route.ts` 的清除补上 `secure: isCookieSecure()`——
**与写入侧同策略**。不硬编码 `true`：开发环境走 HTTP 时 `isCookieSecure()` 为 false，
硬编码会让本地登出失效。

## 三、验证

### 红 → 绿

refresh 分支的 `scope` 断言实现前红（`expected undefined to be '…'`），实现后绿。
组装函数另有 4 条直测（骨架恒在、可选字段缺席即无键、两族共用、空串视为缺席）。

### 变异 P：组装函数漏回 `scope`

| 层 | 结果 |
|---|---|
| 组装函数直测 | **3 条红**（第 4 条"空串视为缺席"保持绿） |
| 端点集成测试 | **1 条红**，失败信息与修复前**逐字相同**（`expected undefined to be 'openid profile email offline_access'`） |

还原后哈希 `df8aa86b78e8fc96…acb0ef` 逐字一致。

### 门禁

| 门禁 | 结果 |
|---|---|
| `pnpm test` | **96 文件 / 778 用例全绿**（95/774 → +1 文件 +4 用例） |
| `tsc --noEmit` | 0 错误 |
| `eslint`（改动文件） | 0 error；1 条 warning 为**既有**（`logout/route.ts` 的 `performRevocation` complexity，已用 `eslint --stdin` 对 HEAD 证明） |

## 四、最佳实践（可复用）

1. **"忘写字段"往往不是粗心，而是数据不在手上。** refresh 分支漏 `scope` 的根因是
   `RefreshTokenResult` 没返回它——**把协议需要的字段放进领域结果、并在组装函数里设为必填**，
   这类漏失才会结构性消失。只改路由是治标（下一个分支还会漏）。
2. **同一端点的两个分支，响应字段集必须对照。** 授权码分支有 `scope`、refresh 分支没有，
   而两者都是同一个 `/token` 端点的成功响应 —— **写协议响应时把两条分支并排看**，
   比逐条读代码更容易发现缺字段。
3. **清除 Cookie 的属性要和写入侧对齐。** 只对齐 `path` 不够：`Secure` 参与
   cookie protection 判定，属性不一致会导致"清不掉"。**清除侧不应硬编码 `true`**，
   要与写入侧用同一个判据（`isCookieSecure()`）。
4. **报告里的跨语言证据要逐条回代码核。** 本轮报告把"内部 API 与 RFC 端点的两套字段名"
   说成"同一动作两套字段名"——**契约本就该不同**，照它去"统一"会破坏内部契约。
   这是本会话第四次因回读代码而更正候选描述（R10 `clients`、R12 注释、R13 路径、本轮跨语言）。
5. **可选的协议字段用"条件展开"而不是 `undefined`。** `exactOptionalPropertyTypes` 下
   `{...(x ? { k: x } : {})}` 是唯一合法写法的同时，也保证序列化后**不出现 `null` 键**
   ——对 SIEM / 严格客户端更友好（有专门用例钉住）。
