# 写路径测试契约 · 同类清扫（#84）—— 以及「门禁真的在拦我」的两次实证

> 日期：2026-10-14
> 来源：**#71**（测试契约那一半）的**同类普查**结果；本轮把普查出的 4 个文件全部修完
> 关联 ADR：**ADR-022**（测试真实性——本轮它的守卫两次拦下我）、ADR-001（管理员绕过）
> 词汇：module / interface / seam / leverage / locality

## 一、清扫范围与结果

普查方法：`grep -rln "vi.mock(import('@/lib/auth')" __tests__/` 得 **13 个文件**，
逐文件数 `rejects.toThrow` —— 命中 **6 个同形**。R22 修了 2 个，本轮把剩下 4 个修完：

| 文件 | 原 `rejects.toThrow` 处数 | 本轮结果 |
|---|---|---|
| `role-actions.test.ts` | 4 | ✅ 9/9 |
| `department-api.test.ts` | 3 | ✅ 10/10 |
| `permission-actions.test.ts` | 2 | ✅ 6/6 |
| `client-actions.test.ts` | 2 | ✅ 8/8 |
| ~~`user-actions.test.ts`~~ | 5 | R22 已修 |
| ~~`department-actions.test.ts`~~ | 4 + 1 | R22 已修 |

`user-role-api.test.ts`(1) **机制不同**（断言审计模块抛错穿透路由），不在本类内。

⇒ 全仓 `rejects.toThrow` 中属于本类者已 **清零**。

## 二、清扫过程中暴露的三类"隐藏依赖"

把 `withAuth` 换成真身，等于把**此前从未真正执行过的鉴权链路**接上——于是它的真实依赖逐个暴露。
这些都不是"顺手"，而是**只有让真身跑起来才会发现的**问题：

### 1. 部分替换 `@/lib/permissions` 会让 `getUserPermissionContext` 变成 `undefined`

`role-actions.test.ts` 与 `permission-actions.test.ts` 里：

```ts
vi.mock(import('@/lib/permissions'), (): Partial<typeof permissionsModule> => ({
  refreshUsersPermissionCache: effectsMocks.refreshUsers,   // 只有这一个导出
}));
```

在此之前无所谓（`withAuth` 被替换，`checkPermission` 从不运行）。真身接上后，
`checkPermission` 需要同一模块的 **`getUserPermissionContext`** ⇒ 它是 `undefined` ⇒
运行时 **TypeError → 500 信封**；而 **`tsc` 不会报**（`Partial<typeof …>` 允许缺项）。

修法：`importOriginal()` + spread，只覆盖需要的那一个导出 ✓。
（这是本会话第 5 次遇到"部分替换导致新用到的导出为 undefined"，见 R6/R13/R16/R18。）

### 2. `beforeEach` 只播种部门，没播种"操作者范围"

`permission-actions.test.ts` 与 `client-actions.test.ts` 的 `beforeEach` 只有
`seedTestData(td.db, { departments: seedRootDept() })`。真身链路要求操作者在库中**真实存在**
且持有 **SUPER_ADMIN** 角色（`checkPermission` 的 admin 绕过，ADR-001），否则一律 403。
⇒ 补上 `users: seedAdminUser()` + `roles: seedSuperAdminRole(...)` + `userRoles: seedUserRoleBinding(...)`
（与 `role-actions`/`department-actions` 的既有写法一致）。

### 3. 单个用例漏调 `seedOperatorScope()`

`department-api.test.ts` 的「创建顶级部门 — ancestors 为 null」只播了部门——
其余用例都显式调了 `seedOperatorScope()`。真身链路下它返回 403 ⇒ 补上该调用 ✓。

> **这三条的共同点**：它们此前**不可能是绿的**（那条链路从没跑过），所以也从未暴露。
> **把 mock 换回真身，等于给这些测试做了一次"依赖体检"。**

## 三、门禁两次真的拦下了我（这是好事）

本轮我触发了两次 CI 门禁失败，两次都**不是**运行时报错，而是**纪律门禁**：

### 1. ADR-022 的 `module-mock-guard`

我把说明性注释写在了 `@allow-module-mock` 注解与 `vi.mock(` 之间，守卫立刻报：

```
"…role-actions.test.ts 第 22 行：理由注解的下一行不是 vi.mock(（孤儿注解）"
"…permission-actions.test.ts 第 47 行：生产模块 @/lib/permissions 缺少 // @allow-module-mock 理由注解"
```

⇒ 规则是**注解必须紧邻** `vi.mock(`。修正后 11/11 通过 ✓。
**这正是 ADR-022 想要的**：注解不是文档装饰，而是**被机器校验的契约**。

### 2. pre-commit 的 typecheck 钩子

（R22 提交时）`ApiResponse` 是判别联合，直接取 `.error` 报 `TS2339` ⇒
断言失败契约需先 `if (r.success) expect.unreachable(...)` 收窄。**测试运行时不会报**，
只有类型检查会 ⇒ 又一次印证 R21（#77）那条「门禁必须真的在检查」。

## 四、验证

| 项 | 结果 |
|---|---|
| 4 个文件 × 2 轮 | **33 用例 × 2 全绿**（9+6+8+10） |
| `pnpm test` | **96 文件 / 786 用例全绿** |
| `tsc --noEmit` | 0 错误 |
| `eslint`（4 文件） | 0 问题 |
| `module-mock-guard` | 11/11（注解形态合规） |

## 五、最佳实践（可复用）

1. **"部分替换模块"是长期负债，它会在你接上真身的那一刻爆炸。** `Partial<typeof X>` 让
   `tsc` 对缺项沉默，运行时却可能是 `undefined`。**只要不是完全替换，就一律 `importOriginal()` + spread。**
2. **把 mock 换回真身，是做一次"依赖体检"。** 本轮换真身立刻暴露三处隐藏依赖
   （缺 `getUserPermissionContext`、缺操作者种子、单个用例漏播范围）——这些依赖**只有真身会要**。
   因此 `auth-bypass` 的粒度应**尽可能细**（只替换身份），而不是整桶替换。
3. **注解挨着它注解的东西。** 说明性注释要写在注解**之前**；把注解与目标隔开，等于取消注解。
   （这是一条纯纪律问题，且已被机器守卫抓到——说明守卫值得写。）
4. **门禁报错时先怀疑自己的改动顺序，而不是门禁本身。** 本轮两次拦阻（注解孤儿、判别联合收窄）
   都是我的形态问题，修正后规则依然成立。
5. **同类清扫要给出可套用的修法，而不是只列文件。** #84 在本轮能一次修完 4 个文件，
   靠的是 R22 已经把修法与依据（`check-permission` 的导入路径 + ADMIN 绕过）写成可复制的模板。
