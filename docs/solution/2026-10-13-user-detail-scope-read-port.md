# 用户详情读口的数据范围缺口 —— 读口按「谁在问」分裂（架构评审 R2 候选 R1）

> 日期：2026-10-13
> 来源：improve-codebase-architecture 架构评审第二轮（Strong 候选 R1，报告 `.arch-review/architecture-review-20261013-100205.html`）
> 关联 ADR：**ADR-014**（数据范围门面，本次同步修订其不实记载）、ADR-002（OBAC 角色-部门绑定）、ADR-016/017（「让失败/缺失可判别」的同源纪律）
> 词汇：module / interface / seam / depth / leverage / locality（codebase-design）

## 一、问题总结

`apps/portal/src/app/(dashboard)/users/data.ts` 的两个详情读口**没有范围参数**：

```ts
export async function getUser(lookupId: string)              // SQL 只有 WHERE id = $1
export async function getUserRoles(lookupId: string)         // 同上
```

而 `(dashboard)/users/[id]/page.tsx` 直接 `getUser(id)` 渲染详情页——该路由唯一的把关是 `users/layout.tsx` 的 `USER_PERMISSIONS.LIST`（只验权限码，不验范围）。**结果：拥有 `portal:user:list` 但范围受限的用户，改 URL 里的 id 即可跨部门读取任意用户的详情，含其角色列表。**

REST 路径 `/api/users/[id]` 之所以没暴露，只是因为**调用点自己补了** `resolveScope` + `isWithinScope → 403`。于是同一读口有两种正确性：REST 侧对，页面侧错。这与 ADR-014「背景」的诊断同源——**缺陷源于 interface 允许了错误用法**，而不是开发者疏忽。

对应需求 `docs/spec/REQUIREMENTS_MATRIX.md:150` **H-ACL-002（🔴关键 P0）**：「用户无法通过直接输入 URL 或修改 API 参数的方式访问其角色所属部门（含子部门）范围之外的信息。」本缺陷正是「直接输入 URL」这一条。

### 为什么它能长期存活

1. **JSDoc 说了谎，而且说了两件事**：`getUser` 的注释写着「已内置底层越权校验（IDOR 防护）与访问日志（Access Log）自动记录」——两件事都不在函数体里（访问日志由 `api/users/[id]/route.ts` 补）。读注释的人不会再去读 SQL。
2. **无人断言**：`__tests__/api/user-api.test.ts` 对 GET 详情只有两例（「返回用户详情」「不存在的用户返回 404」）；跨部门 403 那条分支**零覆盖**。全库 grep 无任何 `getUser(` 的测试。
3. **ADR 的不实记载替它背书**：ADR-014「实施顺序」第 3 步原文声称「**全部只读守卫统一**：`users/[id]`、`users/[id]/roles` GET … 不再手写三连，改由读模型内部 `scopeFilter` 施加」。实测 barrel 侧与 departments/roles 侧为真，**users 这两处从未迁移**。已在本轮修正该记载。

## 二、修复方案

### 决策：读口按「谁在问」分裂为两个，而不是给同一读口加**可选**范围参数

| 读口 | interface | 用途 |
|---|---|---|
| **范围读口** | `getUser(lookupId, scope)` / `getUserRoles(lookupId, scope)` / `getDepartmentOptions(scope)` | admin 读他人：范围经 `scopeFilter` 进入 SQL |
| **身份读口** | `getOwnUser(userId)` | `/api/me`、`/profile`、`(dashboard)/layout` 读**自己** |

**为什么必须两个（必要性，不是对称性）**：操作者的可见范围来自其**角色**的部门子树，而本人的 `dept_id` 完全可能落在该子树之外（角色所在部门 ≠ 本人所属部门）。若让自我读口走范围读口，这类用户会**读不到自己**。测试直接构造了该情形（用户在 MKT、角色在 FE），断言两个读口给出不同答案。

**为什么不加可选 `scope?: UserScope`**：那正是 ADR-014 已记录的 fail-open 形状（`roles/data.ts` 曾因 `deptIds?` 可选而返回全表）。范围必须是必填参数，"有范围"在调用处显式可见。

**实现细节**：内部 loader 收一个 `where`（`findUserWithRoles(where)`），由两个公开读口分别传入「含 `scopeFilter` 的条件」与「仅主键」——`with` 子句只写一份，两个读口的差别只有条件这一行，不变量因此可见。

### 失败语义

范围外与不存在**同形**返回 `null` → 路由映射 404（读路径不用状态码区分存在性，与 ADR-014 第 3 步既有决定、以及 `departments/[id]` 的既有注释一致）。

`getUserRoles` 因此把「不可见」（`null`）与「可见但无角色」（`[]`）分开——此前两者都是 `[]`，调用方无法区分。这是 ADR-016/017 同一条纪律（让失败/缺失可判别，而不是压成哨兵）在读路径上的应用。

## 三、同类问题普查（本仓纪律：修复必须修订同类）

普查范围：全部 11 个 `data.ts` 的每一个导出。

| 读口 | 范围 | 处置 | 理由 |
|---|---|---|---|
| `getUsers` / `getRoles` / `getRoleById` / `getRolePermissions` / `getDepartments` / `getDepartmentById` / `getDepartmentMembers` / `getDashboardStats` | ✅ 已有 | 不动 | ADR-014 第 3 步已迁移并有回归测试 |
| **`getUser` / `getUserRoles`** | ❌ 无 | **本轮修复** | 本文件（见上） |
| **`getDepartmentOptions`** | ❌ 无 | **本轮修复** | **同类的第三处**：被 `users/page.tsx` 与 `roles/page.tsx` 用于部门下拉，范围受限的管理员在下拉里能看到**全部部门**（名称 + ID）。已加必填 `scope` + `scopeFilter` |
| `getOwnUser` / `getUserProfile` / `getUserWithRoleClients` | —（身份绑定） | 不动 | 自我读口，读的是本人；加范围反而读不到自己 |
| `getClientById` / `getClientByClientId` / `getClientTokens` / `getClients` | 无 | 不动 | Client 不是部门子树实体（无 `dept_id` 语义），ADR-014 的守卫在语义上不适用 |
| `getPermissions` / `getPermissionPage` / `getPermissionById` | 无 | 不动 | Permission 是 `client_id` 命名空间的全局权限树，不是部门实体（ADR-008） |
| `getAuditLogs` / `getLoginLogs` / `getAccessLogs` / `getRecentAuditLogs` | 无 | **不动（有意）** | `J-LOG-001` 把审计查询定义为**按操作人、操作类型、时间范围**，`audit_logs` 亦无部门列；审计员是跨部门的合规角色。若要按部门收窄，那是一条新的产品决策，不是本缺陷的同类修订 |

**结论**：同类缺陷共 3 处（`getUser`、`getUserRoles`、`getDepartmentOptions`），全部修复；其余 8 类读口逐条给出不改的理由，避免"看起来像就一起改"。

## 四、验证

### 测试（`apps/portal/__tests__/api/user-detail-scope.test.ts`，13 例，真实 PostgreSQL）

夹具刻意造出互不从属的兄弟部门：`ROOT(0001)` ← `FE(0003)` / `MKT(0005)`；操作者的角色在 **FE**，故其范围 = FE 子树，**不含** ROOT 与 MKT。

覆盖：范围内返回详情 / 范围外 null 且不泄漏字段 / 空范围 null / 无部门用户 null / 不存在与范围外同形 / `getUserRoles` 三态（null、[]、null）/ `getDepartmentOptions` 只返回范围内 / 空范围空列表 / **身份读口在自己的部门不在自己范围内时仍能读到自己** / REST 范围内 200 / REST 范围外 **404（不是 403）**。

### 变异验证（CODING_STANDARDS §1：必须确认失败原因与预期一致）

移除 `getUser` 的 `scopeFilter`（保留 `isScopeDenied` 短路），结果**恰好 5 例变红**：

```
× 范围外用户 → null，且不泄漏该用户的任何字段
× 无部门用户 → null（与 isWithinScope「无法证明归属即拒绝」等价）
× 不存在的用户与范围外用户同形（不可用状态码探测存在性）
× 自己的部门不在自己范围内时，仍能读到自己的记录
× 范围外用户 → 404（不是 403：不泄漏该用户是否存在）
Tests  5 failed | 6 passed (11)
```

保持绿的 6 例正是该绿的：**正向对照**「范围内用户 → 返回详情」（证明文件不是整体变红）、「空范围 → null」（证明 `isScopeDenied` 短路与 SQL 条件各自独立生效）、`getUserRoles` 三例（我只改了 `getUser`，未被波及 → 证明该文件能分辨两个读口）。

`getUser` 的变异前后哈希一致（`949350690faaf283…f767b3`），确认逐字还原。

### 门禁

| 门禁 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错误 |
| `eslint .` | 0 error；86 warning，**改动文件零新增**（`layout.tsx` 的 complexity 告警已用 `eslint --stdin` 对 HEAD 版本证明为既有） |
| `vitest --project @auth-sso/portal-api` | **53 文件 / 484 用例全绿**（修复前 482） |

## 五、最佳实践（可复用）

1. **读口的范围约束必须是必填参数，且进入 SQL。** 「调用方记得加判定」不是约束，是约定；约定会被下一个调用点忘掉——本例正是页面路径忘掉了，而 REST 路径没忘。
2. **「读自己」要另起名字（`getOwnUser`），不要给范围读口加可选参数。** 可选参数同时制造两种失败：省略即不过滤（fail-open），以及自我读口在范围不含本人时读不到自己。
3. **JSDoc 里的安全声明必须能在函数体里指出对应语句。** `getUser` 声称「已内置 IDOR 防护」而 SQL 里只有 `id = $1`，这行注释让三个审阅者跳过了检查。写不出对应语句的声明，就是缺陷。
4. **变异验证要同时看"红了哪几条"和"还绿着哪几条"。** 只有"变红"不够：必须有一条正向对照保持绿（否则可能是文件整体崩了），且未被变异的兄弟读口保持绿（证明测试能分辨）。
5. **修一处就要普查同类，并写下"不改的理由"。** 本次普查 11 个 `data.ts` 的全部导出：修 3 处、逐条记录 8 类不改的理由。审计读口看似同类，但 `J-LOG-001` 把它定义为按操作人/类型/时间的跨部门查询——**没有写下理由的"同类"，下一个人会当成漏修**。
6. **ADR 的"已完成"勾选要能指向具体代码。** ADR-014 第 3 步把两处未迁移写成 ✅，直接替缺陷背书了一周。勾选时给出文件与函数名；只有 barrel 侧做到就写「barrel 侧完成」。
