# 鉴权失败的"一个答案"：判别式联合 + 错误码词汇表收窄（架构巡检候选 1）

> 日期：2026-10-15
> 来源：`/improve-codebase-architecture` 巡检候选 1（`Strong`，第二顺位）
> 巡检报告：`docs/archive/architecture-review-2026-10-15.html`
> 词汇：module / interface / depth / seam / leverage / locality

## 一、三个互相纠缠的症状（同一根因）

**根因：`PermissionCheckResult` 是"字段全可选"的松散接口，于是它无法表达自己其实知道的事实。**

```ts
// 之前
interface PermissionCheckResult {
  authorized: boolean;
  userId?: string;      // "通过但没有 userId" 是可表达的 ⇒ 调用点得补一个 500 分支
  error?: string;       // 装的是**中文文案**，却被调用点当**码**用
  statusCode?: number;
}
```

| 症状 | 证据 |
|---|---|
| `withAuth` 两个 catch **逐字相同** | `guard.ts:43` 与 `:47`；`mapServerError` 在这个 module 自己体内出现 3 次 |
| `check.error` 是文案却被当码 | `guard.ts:35` 把它写进 `ApiError.error`——契约里那是**码** |
| 同一失败两面不同答案 | `withAuth` 恒 403 + `FORBIDDEN`；`withPermission` 用 `check.statusCode`（未登录 401，但码仍是 `FORBIDDEN` ⇒ **401 配 FORBIDDEN 自相矛盾**） |

最尖锐的证据来自**替身**：`user-api.test.ts` 手写的 `withAuth` 替身返回
`error: 'FORBIDDEN'`——一个**生产代码从不发出的码**。接口说不出"error 必须是词汇表里的码"，
于是替身长出了一个假事实，而编译器毫无异议。

## 二、做法

1. **结果改判别式联合**（`check-permission.ts`）：
   `{ authorized: true; userId: string } | { authorized: false; reason: DomainError }`
   ⇒ "通过但无 userId" 与 "error 装文案" 两个状态**在类型上不可表达**。
   失败携带 `DomainError`（自带码与状态），"哪个码 + 哪个状态"只剩一处。
2. **新增 `UnauthenticatedError`（401，`AUTH_SSO_1002`）并注册** `ERROR_STATUS`。
   "未登录/会话失效"此前**没有**对应的领域错误——这正是状态码分歧的根源。
3. **guard 失败一律抛出**：`if (!check.authorized) throw check.reason;`
   ⇒ 一个 `try` / 一个 `catch` / 一个 `mapServerError`（"唯一服务端错误映射入口"），
   鉴权失败与业务错误走**同一条路**。`withAuth` 整函数由 **25 行收到 20 行**（内部闭包 20→15）；
   `withPermission` 的"鉴权上下文缺失 ⇒ 500"分支被**删除**（它已不可表达）。
4. **`ApiError.error` 由裸 `string` 收窄为 `ErrorCode`**（`packages/contracts`）。

## 三、收窄的余波比想象小得多（值得记下）

收窄契约类型后 `pnpm -r typecheck` 报 **16 处**错误（报错点在 5 个 actions.ts：departments 2 / permissions 2 / roles 2 / users 6 / profile 2）。逐条看：**改一处即可全消**——
`apps/portal/src/lib/validation.ts` 自己手抄了一份失败信封类型：

```ts
type Invalid = { ok: false; response: { success: false; error: string; message: string } };
```

把 `ApiError` 从契约里搬过来（`type Invalid = { ok: false; response: ApiError }`）⇒
**16 → 0**，且顺手删掉一处重复定义。**教训：先看余波从哪里来，再决定"改动太大"这个判断。**

## 四、验证

| 项 | 结果 |
|---|---|
| `pnpm -r typecheck` | **4/4，0 error**（收窄后从 16 处降到 0，只改了 1 个文件） |
| `pnpm test` | **105 文件 / 884 用例全绿**（+1：新的"三面一致"不变量测试） |
| **变异** | 把"未登录"退回 `ForbiddenError`（旧行为的等价物）⇒ **6 条红**（`permission-enforcement.test.ts` 6 failed / 23；并发清库时条数会漂移，故只记这一次独占观察）⇒ 还原后 `git diff` 为空 |
| 新增不变量测试 | 一条测试同时断言 **`checkPermission` 的原因 / `withAuth` 的 `ApiError` / `withPermission` 的响应**都指向 `401 + UNAUTHORIZED` |
| 断言强度 | 8 条状态码断言从"裸数字"升级为"**原因的类型** + 映射后的状态"（`instanceof UnauthenticatedError` + `status === 401`） |

## 五、对外可见的变更（已写入 `CHANGELOG.md` 的 `[Unreleased]`）

未登录时 portal API 的错误码由 `AUTH_SSO_1003`（`FORBIDDEN`）改为 **`AUTH_SSO_1002`（`UNAUTHORIZED`）**——
HTTP 状态码本来就是 401，配 `FORBIDDEN` 是自相矛盾。Server Action 面同理（此前恒 `FORBIDDEN`）。

## 六、最佳实践（可复用）

1. **接口无法表达的不变量，会在替身里长成假事实。** `'FORBIDDEN'` 这个码没有任何生产路径发出，
   但它在测试里活了很久，因为没有任何机制能说不。**把不变量写进类型**是最省事的根治。
2. **"字段全可选"是浅接口的典型症状。** 判别式联合让"不可能状态"不可表达，
   顺带删掉调用点为了兜底而写的分支（本次删掉一个 500 分支）。
3. **失败要汇聚到唯一的映射入口。** 抛出领域错误 ⇒ 与业务错误共用同一个 `catch`/映射，
   而不是"鉴权一处、业务一处"两份逐字相同的代码。
4. **类型收窄前先数余波。** 16 处报错看起来像大工程，实际是 1 处重复定义。
   反过来也成立：**别用"报错太多"当作不修的理由**。
5. **外部可见的码/状态变化必须进 changelog。** 即便是"修正矛盾"，集成方也可能按旧码分支。
