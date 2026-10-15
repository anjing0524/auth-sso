# 表单失败处置：不建 `useEntityForm`，让**所有**失败走已存在的单一分类点（架构巡检候选 5）

> 日期：2026-10-15
> 来源：`/improve-codebase-architecture` 巡检候选 5（`Worth exploring`，建议抽 `useEntityForm`）
> 巡检报告：`docs/architecture-review-2026-10-15.html`
> 结论：**部分采纳**——不抽新 hook；把巡检指出的失效模式用**已有的**分类点 + 机械守卫根治。

## 一、审计：绕过比巡检说的更多

巡检说"5 个 mutation 里只有 3 个接了 #82/#92 的分类，同一文件内 delete 绕过 `reportFailure`"。
写了一条守卫去**枚举**这一类之后，实测**全类 12 个收口点（分布在 10 个文件）**：

| 文件 | 绕过形态 |
|---|---|
| `roles/components/RolesTable.tsx` | 状态切换 `toast.error(res.message)` |
| `permissions/components/PermissionsTable.tsx` | 删除 |
| `departments/components/DepartmentTree.tsx` | 删除 |
| `clients/components/ClientsTable.tsx` | 删除 |
| `clients/new/page.tsx` | 创建 |
| `users/[id]/UserDetailForm.tsx` | 更新、删除（2 处） |
| `users/new/page.tsx` | 创建 |
| `profile/ProfileClient.tsx` | 改密、改资料（2 处） |
| `users/components/AssignRoleDialog.tsx` | 角色分配（fetch 的 `body.message`） |
| `users/components/UserTable.tsx` | 启用/停用 |

## 二、为什么不抽 `useEntityForm`

1. **需要的"单一分类点"已经存在**（`useFieldFailure`，#92）。真正的缺口不是缺抽象，
   而是"有些调用点没走它"。
2. **表单异质**：字段各不相同；`users/new` 是受控 `useState`，`UserDetailForm` 是 props + 局部
   state，`AssignRoleDialog` 甚至经 **fetch** 拿 REST 响应。一个同时管"表单状态 / 对话框开合 /
   saving / refresh / 字段错误"的 hook，接口会很宽 —— 又是浅接口。
3. **这些表格没有组件测试**（`__tests__/components/` 只覆盖 DataTable / EmptyState / Sidebar /
   CommandPalette / AuditLogs / PermissionGuard）⇒ 大规模重构**无网可依**。

⇒ 按删除测试：删掉假想的 `useEntityForm`，复杂度回到"每处几行编排"——而这几行本来就不重复到
值得一个宽接口的程度。**不建。**

## 三、做法：让所有失败都走同一个分类点

1. **`useFieldFailure(renderedFields)` 的参数改为可选（默认 `[]`）**：不渲染 `<FieldError>` 的表单
   也能用同一个分类点，行为与原来一致（一律 toast）。语义仍然是"**真的渲染了**才算"——
   传未渲染的字段会静默吞掉错误，所以不渲染表单必须传空（注释已写明）。
2. **12 个收口点统一改为 `reportFailure(res)`**（其中 8 处补上 hook 接线）。
3. **新守卫** `__tests__/api/form-failure-handling-guard.test.ts`：禁止把 Server Action 结果的
   `message` 直接交给 `toast.error`（那正是绕过分类点的形状）。纯前端校验的字面量提示不算；
   确有需要的写 `// @allow-direct-toast: <理由>`。

## 四、顺带修掉守卫自身的一个缺陷

第一版守卫**报的行号是错的**：它先 `stripComments` 再按行定位，而共享的 `stripComments` 把块注释
**连同换行**一起删掉 ⇒ 其后的行号整体前移（`read-scope-usage-guard` 同样受影响）。
⇒ 修共享实现为"块注释替换成等量空白但**保留换行**"，并把测试从"逐字断言"改为
"**断言行结构不变**"（更贴合契约：守卫按行报点）。

## 五、验证

| 项 | 结果 |
|---|---|
| `tsc` | 退出码 0 |
| `pnpm test` | **退出码 0**（**108 文件 / 901 用例**，+1 文件 +6 用例） |
| `pnpm -r lint` | **退出码 0**（`0 errors, 82 warnings`，未因本次改动新增） |
| **变异** | 把 `UserTable` 退回 `toast.error(res.message)` ⇒ 守卫**当红**并点名 `UserTable.tsx:156` ⇒ 还原后 `git diff` 为空（逐字节） |
| 行为 | 基本保持：不渲染 `<FieldError>` 的表单仍然一律 toast。**但首版收口时 5 处的兜底文案被丢掉**（空 message 会 toast 空串）——代码评审查出后已作为 `reportFailure(res, fallback)` 参数补回，并加护栏 |

## 六、顺带发现（不动手，记录）

`users/components/AssignRoleDialog.tsx` 用 **fetch** 调 REST 路由完成内部页面的角色分配 ——
与"内部页面写操作只用 Server Actions"的约定相悖（`AGGREGATE` 边界的例外是外部系统/跨域/OIDC 回调）。
本次只把它的失败接进分类点，**不顺手重构**（Surgical Changes）。**触发条件**：当该对话框需要新增第二种写操作、或"内部页面写操作只用 Server Actions"再次被违反时，一并改为 Server Action 并补组件测试。

## 七、最佳实践（可复用）

1. **"缺抽象"常常其实是"没走已有的抽象"。** 先查有没有既存的单一入口，再谈新建；
   建宽接口去包异质表单，只会把多种正确性挤进一个函数。
2. **没有测试网的大规模 UI 重构 = 赌博。** 先看 `__tests__/components/` 覆盖了什么；
   没有覆盖就选"行为保持 + 机械守卫"这条路。
3. **守卫要给出可用的行号。** 行号错了，守卫的价值减半——本次正是"去注释时把换行也删了"
   造成的偏移。凡按行报点的检查，都必须保证**行结构不被预处理破坏**。
