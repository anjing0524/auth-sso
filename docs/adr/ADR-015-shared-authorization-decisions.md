# ADR-015: 授权判定收敛为 contracts 共享纯函数 —— 消除服务端/客户端双重实现

| 属性       | 值                                                                    |
|------------|-----------------------------------------------------------------------|
| **状态**   | implemented (2026-10-08)                                              |
| **日期**   | 2026-10-08                                                            |
| **决策者** | Auth-SSO 团队（improve-codebase-architecture 架构评审候选 ③）          |
| **影响范围** | `packages/contracts/src/authorization.ts`（新增）、`lib/auth/check-permission.ts`、`hooks/use-permissions.ts`、`lib/menu-tree.ts`、`app/api/me/route.ts`、`app/(dashboard)/layout.tsx`、`app/profile/ProfileClient.tsx`、`domain/auth/oauth-authorize.ts` |

## 背景

"某主体是否可执行某操作"这条判定，在 Portal 里被实现了 **7 次**，且**每条规则都被同时写在服务端与客户端**：

| # | 位置 | 形态 |
|---|---|---|
| 1 | `lib/auth/check-permission.ts:73` | `roles.some(rc => ADMIN_ROLE_CODES.includes(rc))` + 内联 `checkList` |
| 2 | `hooks/use-permissions.ts:64` | `ctx.roles.some(r => ADMIN_ROLE_CODES.includes(r.code))` |
| 3 | `app/api/me/route.ts:37` | 同规则，第三份拷贝 |
| 4 | `app/(dashboard)/layout.tsx:31` | 同规则，第四份拷贝 |
| 5 | `app/profile/ProfileClient.tsx:271` | 同规则，第五份拷贝 |
| 6 | `domain/auth/oauth-authorize.ts:41` | `new Set(ADMIN_ROLE_CODES)`，第六份 |
| 7 | `lib/menu-tree.ts:52` | 内联 `!m.code \|\| isAdmin \|\| userPermissions.includes(m.code)` |

**最要命的是第 1 与第 2 的关系**：服务端的 `checkList(required, owned, requireAll)` 与客户端的 `hasPermission` / `hasRole` 是**同一套语义的两份独立实现**。任何一处偏离或演进不同步，都会表现为"按钮能点但提交 403"或"菜单可见但页面 403"——这类缺陷在手工测试中极易漏过，因为两侧各自都是"对的"。

另有 `ADMIN_ROLE_CODES` 的成员测试写法分叉：`(as readonly string[]).includes`、`new Set(...)`、以及直接传 `r.code` 或已映射的 `r`。

## 决策

### 1. 判定实现落在 `packages/contracts/`

新增 `authorization.ts`，导出纯函数：`isAdminRole` / `hasPermissionCode` / `can` / `hasRole` / `canAny` / `canAll`，以及 `AuthorizationSubject` 类型。

**为什么是 contracts 而不是 `apps/portal/src/domain/`**：客户端与服务端必须共享这层判定，而 `apps/portal/src/domain/**` 受 `server-only` 边界约束（`domain/` 禁止 import `next/*`，但服务端专用模块会被 `server-only` 标记），不能跨到客户端。`packages/contracts` 已零依赖、纯 TS、无 `node:*`/`server-only`，客户端可安全导入，且它**已经是判定输入（`ADMIN_ROLE_CODES`、各类权限码）的单一真相源**——规则与规则输入同处一包。

### 2. `ADMIN_ROLE_CODES` 移入独立模块，使依赖图无环

`authorization.ts` 需要 `ADMIN_ROLE_CODES` 做管理员判定，而 `index.ts` 又 re-export `authorization.ts`——常量若留在 `index.ts` 会形成 `index → authorization → index` 循环。正确性会依赖模块求值顺序这种脆弱性质。

因此新增 `admin-roles.ts`，依赖图变为无环：`admin-roles` ← `authorization` ← `index`。

### 3. `roles` 与 `requireAll` 选项**保留**（修正一次误判）

收敛过程中一度判定这两个选项是死配置并删除——**该判定是错的**。它们在 `permission-enforcement.test.ts` 有 5 处测试覆盖（`requireAll` 的"缺任一即 403"/"全部具备即通过"、`roles` 的"匹配即通过"/"不匹配即 403"）。虽然生产代码没有调用方，但**有测试覆盖的公开选项不是死配置**，删除它会改变公开契约并让测试变红。

最终实现忠实保留原语义，并把判定下沉到共享函数：

```ts
// 管理员绕过权限码检查（ADR-001 既有语义）。角色归属**不**因此绕过。
if (isAdminRole(subject.roleCodes)) return { authorized: true, userId };

if (options.permissions?.length) {
  const ok = options.requireAll
    ? canAll(subject, options.permissions)
    : canAny(subject, options.permissions);
  if (!ok) return { authorized: false, userId, error: '权限不足', statusCode: 403 };
}

if (options.roles?.length) {
  const ok = options.requireAll
    ? options.roles.every((code) => hasRole(subject, code))
    : options.roles.some((code) => hasRole(subject, code));
  if (!ok) return { authorized: false, userId, error: '角色权限不足', statusCode: 403 };
}
```

### 4. `can` 与 `hasRole` 的区别是**刻意的**，不是疏漏

- `can(subject, permission)` —— 管理员恒通过（绕过的是**权限**）
- `hasRole(subject, roleCode)` —— 管理员**不**自动通过（角色归属不能被管理员身份伪造）

这条区分由测试显式钉住：`hasRole(ADMIN, 'AUDITOR') === false`。需要"必须是某角色"的场景（如仅审核员可复核）必须用 `hasRole`。

### 5. `menu-tree` 的 interface 改为接收 `AuthorizationSubject`

原先接收 `(userPermissions: string[], isAdmin: boolean)`，把内联判定留在函数体内。现改为接收 subject，判定委托 `can`——消除第七份拷贝，同时让"没有权限码的菜单项对所有已登录用户可见"（`!m.code` 分支）成为**一处**语义。

### 6. 本模块**不做**的事（seam 划分）

`authorization.ts` 不查库、不读缓存、不抛错、不映射 HTTP 状态码。**取数**（权限上下文的读取、Redis 降级、fail-open/fail-close）与**判定**（本模块）是两个 seam：

- 取数的失效语义见 **ADR-011**（缓存性数据 fail-open 降级 DB）
- 判定是纯函数，零 I/O，可穷举测试

这与 ADR-005 的三层模型不冲突：ADR-005 规定**分层**（Gateway 验签 → proxy CSRF → withAuth/withPermission 精细鉴权），本 ADR 规定**层内的判定如何实现**，不改变层次边界。

## 后果

**收益**
- 授权语义从 7 份拷贝收敛为 1 份实现；服务端与客户端**不可能再分叉**。
- 判定成为纯函数，零 I/O，可穷举测试（15 个用例）。
- `ADMIN_ROLE_CODES` 的成员测试写法统一为集合查找（`isAdminRole`），不再有 `includes` / `Set` / 传 `r.code` 三种写法。
- `hasRole` 与 `can` 的语义差异被显式化，不再靠各处"碰巧写对"。

**代价**
- `packages/contracts` 从"只有常量与类型"扩展为"含极少量纯函数"。仍零依赖、无副作用，但**包职责描述需同步更新**（不再只是常量容器）。
- `menu-tree` 的 interface 变更（`(string[], boolean)` → `AuthorizationSubject`），2 处调用方改动。
- `check-permission.ts` 的 `roles`/`requireAll` 选项仍无生产调用方——保留是为了不破坏公开契约与既有测试；若将来确认无人使用，应作为**独立决策**删除并同步删测试，而不是在重构中顺手删。

**未覆盖**：本次只收敛"判定"。`getUserPermissionContext` 的取数与降级路径未动（属 ADR-011 范围）。

## 验证

- `packages/contracts/src/__tests__/authorization.test.ts`：15 个用例，覆盖管理员绕过、`can` 与 `hasRole` 的语义差异、`canAny`/`canAll` 两种模式、空需求、大小写敏感。
- `permission-enforcement.test.ts`（22 例）全绿——证明 `roles`/`requireAll` 语义在迁移后**逐位保持**。
- 全量：`tsc` 0 错误；`pnpm test` 52 文件 / 436 用例全绿；`lint` 0 errors。
- 追溯：`pnpm test:report` 已将新测试识别为 `H-ACL-001` 的覆盖来源。

## 相关 ADR

- ADR-001: 统一权限树（`ADMIN_ROLE_CODES` 为系统预置角色的来源）
- ADR-005: 三层安全模型（本 ADR 规定层内判定的实现方式，不改分层）
- ADR-011: 故障语义分级（取数层的降级语义，与本 ADR 的纯判定分离）
- ADR-014: 数据范围授权门面（同一"收敛为单一实现"的手法应用于 OBAC 数据范围）
- ADR-008: 权限码命名空间（权限码的形态来源）
