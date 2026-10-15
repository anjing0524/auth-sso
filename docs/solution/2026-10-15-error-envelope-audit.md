# 错误信封审计：**不全盘建**统一翻译点，修掉三处具体缺陷（架构巡检候选 4）

> 日期：2026-10-15
> 来源：`/improve-codebase-architecture` 巡检候选 4（`Worth exploring`，建议把 4 种信封收成一个翻译点）
> 巡检报告：`docs/architecture-review-2026-10-15.html`
> 结论：**建议部分采纳**——巡检的"4 种形状各拼一次"与实际不符；真正的缺陷是**三处具体**的，已修。

## 一、审计：REST 面**已经**是单点，"4 种形状"实为**5 种协议**

巡检说"12 个 route 各拼一次信封"。逐个看完后：REST 面**早已**集中在一个工厂里
（`lib/response.ts` 的 `restError` ✓），其余形状不是"重复"，而是**协议不同**：

| 形状 | 出现的协议 | 是否应该统一 |
|---|---|---|
| `{ error, message }` | REST（`restError` ✓ 单点） | 已统一 |
| `{ error, error_description }` | OAuth token / authorize（RFC 6749 §5.2） | 形状不同 |
| `error` + `WWW-Authenticate` 头 | userinfo（RFC 6750 §3） | 错误**载体**是头 |
| `?error=…&state=…` **重定向** | authorize（RFC 6749 §4.1.2.1，`buildRfc6749ErrorRedirect` ✓） | 不是响应体 |
| `{ success:false, error, message }` | Server Action（RPC，无 HTTP 状态） | 无状态码可携带 |

⇒ 一个"统一翻译点"必须编码 **5 种协议**，那是 **dispatcher**，不是深化；
而 REST 面本来就已经单点。**不建。**

## 二、但审计抓到三处真实缺陷（已修）

### 1. `restError(code: string)` 是裸类型 ⇒ 词表外的码流进了响应体

`permissions/register/route.ts:64` 直接写 `restError('conflict', …)` —— `'conflict'`
**不在** `ErrorCode` 词汇表里（契约里是 `PERMISSION_ERRORS.PERMISSION_ALREADY_EXISTS` = `AUTH_SSO_6002`）。
**修法是把类型收窄**（与 `ApiError.error` 同一把锁）：收窄后编译器**精确报出这一处**（0 → 1 → 0），
没有第二处。

> 附带发现：**测试把这个缺陷锁住了**。`permission-api.test.ts` 断言 `body.error === 'conflict'`
> ——测试固化了一个生产从不该发出的码。收窄后它编译不过，遂改为专属冲突码。

### 2. `auth/jwks` 手抄了 `restError` 的信封

```ts
return NextResponse.json({ error: mapped.error, message: mapped.message }, { status: mapped.status });
```
与 `restError` **逐字相同** ⇒ 改用工厂（信封形状只能有一处）。

### 3. `userinfo` 的**兜底**把内部码回给 OIDC 客户端（协议不合规）

```ts
const mapped = mapServerError(err);
return NextResponse.json({ error: mapped.error }, { status: mapped.status });   // { error: "AUTH_SSO_1006" }
```
`/api/auth/oauth2/userinfo` 的消费方是第三方 RP 的 OIDC 客户端库，只认 RFC 6750 §3 的错误名；
而且 401 MUST 携带 `WWW-Authenticate`。显式失败路径（无 token / 验签失败 / 用户不存在）
本来就是对的，**只有兜底**漏了。现按状态映射：`400 → invalid_request`、`403 → insufficient_scope`、
`401/404 → invalid_token`、`5xx → server_error`，并在非 5xx 时带上匹配的 `WWW-Authenticate`。

## 三、验证

| 项 | 结果 |
|---|---|
| `tsc` | 退出码 0；收窄过程**精确**报出唯一的词表外码 |
| `pnpm test` | **退出码 0**（**107 文件 / 895 用例**，+1 文件 +3 用例） |
| `pnpm -r lint` | **退出码 0**（`0 errors, 82 warnings`） |
| 新测试 | `oidc-userinfo-error-envelope.test.ts` 3 用例：5xx ⇒ `server_error` 且**显式断言响应体不含 `AUTH_SSO_`**；403 ⇒ `insufficient_scope` + 头；401 回归对照 |
| 修好的测试 | `permission-api.test.ts` 的 409 用例从 `'conflict'` 改为 `PERMISSION_ERRORS.PERMISSION_ALREADY_EXISTS` |

**过程记录（ADR-022 机制的真实用法）**：新测试最初用 `Partial + importOriginal` mock 数据模块 ⇒
撞上 `src/db/user-queries.ts:18` 在**模块加载期**读 `schema`（而 mock 工厂早于测试模块执行，
那时测试句柄还没建）⇒ 改用 ADR-022 的 **`full-replacement`** 声明。期间还被守卫抓到两次：
字符串形态的 `vi.mock('…')` **不允许**用于生产模块；理由注解必须**紧贴** `vi.mock(`。
——这两条正是往轮把"声明"变成"可执行副本"的收益。

## 四、对外可见变更（已写入 `CHANGELOG.md`）

`/api/auth/oauth2/userinfo` 的错误体从**内部码**（`AUTH_SSO_xxxx`）改为 RFC 6750 错误名；
401/403 现在带 `WWW-Authenticate`。按内部码分支的 RP 需要改。

## 五、最佳实践（可复用）

1. **"重复"要先审计再动手。** 五处形状看起来像同一个抽象，实际是五种协议；把 dispatcher
   叫成"统一翻译点"，只会让每条协议的正确性重新散落在同一个大函数里。
2. **裸 `string` 类型是词汇表泄漏的入口。** 收窄成闭合词汇表后，编译器一次就点出了唯一一处
   违规——比写十条规范便宜。
3. **测试也会固化缺陷。** `'conflict'` 被断言活了很久；类型收窄迫使它一并改正
   （这也是"接口即测试面"的又一面）。
4. **对外协议的错误体一律用协议自己的错误名。** 内部码只属于内部日志与 REST 契约。
