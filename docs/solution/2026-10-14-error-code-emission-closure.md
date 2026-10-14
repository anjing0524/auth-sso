# 让契约里的业务码被真正发射（二）：冲突码族、404 统一、删除 24 个死码与静态守卫（#82 收尾）

> 日期：2026-10-14
> 来源：**#82**；第一族（规则码）见 `2026-10-14-entity-rule-error-codes.md`
> 关联 ADR：ADR-018（失败原因可判别）；`docs/spec/API.md:44`（404 约定）
> 词汇：module / interface / seam / leverage / locality

## 一、`*_ALREADY_EXISTS` 族：让"哪个字段冲突"可定位

`DuplicateEntityError` 增加可选专属码（与 R19 的 `BusinessRuleViolationError` 同机制）：

```ts
new DuplicateEntityError(entity, field, code?)
```

两个发射面：

1. **内联查重**（actions 里显式查询）：
   - `permissions/actions.ts` → `PERMISSION_ALREADY_EXISTS`
   - `roles/actions.ts` → `ROLE_ALREADY_EXISTS`
   - `users/actions.ts` → **拆开**判断以分别报 `USERNAME_ALREADY_EXISTS` / `EMAIL_ALREADY_EXISTS`
     （原先是一条查询 + 一个合并的 `('User', 'username/email')` 错误——码无从选择）
2. **PG 唯一约束违例**（`lib/server-error.ts` 的映射，原先只有通用码）：新增
   `CONFLICT_CODES['表:列'] → 码`，覆盖 `users:username|email|mobile`、`roles:code`、
   `departments:code`、`permissions:code`、`clients:client_id`，并对 `users` 提供实体级回落
   （`USER_ALREADY_EXISTS`，复合唯一约束时使用）。

**为什么值得**：表单需要把冲突定位到**具体输入框**。原先客户端只能解析
`"用户 的 用户名 已存在"` 这段中文——**文案一改就错配**。

## 二、⚠️ 自查更正：404 应当**统一**为 `AUTH_SSO_1004`（我上一轮做反了）

上一轮（第一族）我看到"5 个实体路由里 3 个用专属 404 码、2 个用通用码"，判断是**不一致**，
于是把 `permissions/[id]` 补成了专属码。**本轮回读文档后发现方向错了**：

```
docs/spec/API.md:44  | 资源不存在 | 404 | { "error": "AUTH_SSO_1004", ... } |
```

⇒ **文档约定的就是统一码**；R11 的提交记录也写了"与 API.md「资源不存在 → 404 → `AUTH_SSO_1004`」
对齐，`AUTH_SSO_3001` 全库无消费方"。所以真正的不一致是**另外那 3 个路由违背了文档**。

处置：**5 个路由全部统一**到 `COMMON_ERRORS.NOT_FOUND`，并删除 5 个实体级 not-found 码
（`USER_NOT_FOUND` / `DEPARTMENT_NOT_FOUND` / `ROLE_NOT_FOUND` / `PERMISSION_NOT_FOUND` / `CLIENT_NOT_FOUND`）。

**理由（写进契约文件注释）**：资源类型由 **URL 表达**（`/api/users/xxx` 已说明是用户），
实体级 not-found 码**不增加任何信息**，却与文档矛盾。

> 这是本会话的**第 6 次**因回读既有决定而更正候选/自身上一轮的判断
> （R10 `clients`、R12 注释、R13 路径、R17 跨语言、R26 Rust 可见性、本轮 404）。
> **结论**：动手前先查"这个决定以前有人做过吗"——比凭直觉改一致更快也更准。

## 三、删除 24 个零引用码（57 → 33）

| 类别 | 码 | 理由 |
|---|---|---|
| 规则码（**改为接通**，见第一族） | 8 | — |
| 冲突码（**改为接通**，见第一节） | 8 | — |
| 密码策略 | `PASSWORD_TOO_WEAK`（**接通**） | `users/actions.ts` 的策略校验 |
| 无发射点的通用码 | `UNKNOWN_ERROR` · `INVALID_REQUEST` · `PAYLOAD_TOO_LARGE` | 意外错误由 `INTERNAL_ERROR` 承担；后两者的唯一"使用者" `telemetry/route.ts` **已不存在**（2026-07 的审计记录已过期） |
| 安全上**刻意不区分** | `LOGIN_FAILED` · `ACCOUNT_NOT_FOUND` | 区分"账号不存在/密码错"是账号枚举漏洞；`INVALID_CREDENTIALS` 已在用 |
| Gateway 不发射契约码 | `SESSION_*`×3 · `TOKEN_*`×3 · `REFRESH_TOKEN_EXPIRED` | Gateway 返回的是 **OAuth 错误字符串**；Portal 用 `REFRESH_TOKEN_INVALID` |
| 走文案路径 | `INVALID_STATE` · `INVALID_NONCE` | callback 走 `?error=csrf_mismatch/nonce_mismatch` |
| 有意不区分 + 重复 | `CLIENT_DISABLED`（不区分停用/不存在）· `INVALID_REDIRECT_URI`（与 `OAUTH_INVALID_REDIRECT_URI` **重复**） · `INSUFFICIENT_PERMISSIONS`（与 `FORBIDDEN` **重复**） | — |
| 无该功能 | `SECRET_ROTATION_FAILED` · `INVALID_PASSWORD` | — |
| 404 统一 | 5 个 `*_NOT_FOUND` | 见第二节 |

**两条纪律写进契约文件**：①**不重编号**（删除留下的空洞永久保留——码是上网的线值，
复用会让历史日志与客户端配置产生歧义）；②**404 统一用 `NOT_FOUND`**。

`docs/spec/API.md` 同步移除 `AUTH_SSO_1001` / `AUTH_SSO_1007` 两行。

## 四、静态守卫：让"没有死码"永久生效

新增 `packages/contracts/src/__tests__/error-code-usage.test.ts`（契约包，**已被 typecheck 覆盖**——#77）：

- 从 `errors.ts` **动态解析**全量码（不手写第二份）；
- 扫描 `apps/` 与 `packages/` 的 `.ts/.tsx/.rs`（**不含** `docs/` 与 JSON 夹具——文档提到不算发射点）；
- 断言：**不存在零引用的码**（无白名单），失败消息直接给出可操作指引
  （"要么接通…要么从 contracts 删除"）。
- 含**解析器自测**（`codes.length > 20` 且含已知码），防止解析失败导致守卫"永远通过"。

**变异 Y**（新增一个无人引用的 `NEVER_EMITTED`）→ 守卫**精确变红**并点名该码 ✓。

## 五、顺带修好一个**测试基础设施陷阱**（本轮自己踩到）

我为冲突测试写夹具时写成 `seedTestData(db, { users: seedTestUser({...})[0]! })`——传了**对象而非数组**。
`seedTestData` 的实现是 `if (data.users?.length) …` ⇒ **整段种子被静默跳过**，用例于是
"创建成功了重复用户"——**假绿**。

处置两层：
1. 修夹具（传数组）；
2. **加固 `seedTestData`**：任何字段不是数组 ⇒ 立刻 `TypeError`，错误消息写明
   "静默跳过会让用例假绿"。加固后**全量套件无新增失败**（说明其它文件没有同类问题）。

> 这类"夹具静默失效"在本会话已是**第三次**（R13 auditLogs、R21 根部门重复播种、本轮）。

## 六、验证

| 项 | 结果 |
|---|---|
| 契约码 | **57 → 33**，且**零引用 = 0**（守卫强制） |
| `pnpm test` | **98 文件 / 812 用例全绿**（+1 文件 2 用例守卫 + 3 条冲突/策略用例） |
| `tsc --noEmit`（portal + contracts） | 0 |
| `eslint`（改动文件） | 0 error（1 条 warning 为**既有**） |
| 变异 | **Y**（新增死码）→ 守卫精确变红；**U/V/X/W**（前几轮）亦然 |

## 七、最佳实践（可复用）

1. **"哪个字段冲突"是表单刚需，所以冲突码值得接通。** 让客户端解析 `"…的…已存在"` 这类中文，
   等于把文案变成 API 契约的一部分。
2. **动手前先查"这个决定以前有人做过吗"。** 本轮 404 的方向就是被 `API.md` 与 R11 的提交记录纠正的；
   凭直觉改"一致性"很容易改反——**文档与历史提交是本仓库的第二份规格**。
3. **删除死码要留下"为什么不重编号"的记录。** 线值复用会让历史日志产生歧义；
   空洞是**有意保留**的，必须在契约文件里写明，否则后来者会"顺手"整理编号。
4. **让纪律变成测试。** 34 个死码是慢慢长出来的，没有任何门禁阻止它——本轮补的守卫
   把"每个码都要有人发射"变成 CI 的硬约束（且含**解析器自测**，避免守卫自身失灵）。
5. **测试夹具的静默失效比测试失败更危险。** 传错形状的种子会**无声地**让用例跑在空数据上；
   加固助手（非数组即抛）比逐处 review 更可靠。
