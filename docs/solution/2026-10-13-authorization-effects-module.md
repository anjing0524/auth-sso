# 权限决策变更后的收敛动作 —— 一个概念收成一个 module（架构评审 R2 候选 R4）

> 日期：2026-10-13
> 来源：improve-codebase-architecture 架构评审第二轮（Strong 候选 R4，报告 `.arch-review/architecture-review-20261013-100205.html`）
> 关联 ADR：ADR-011（故障语义分级）、**ADR-019**（其根因诊断「缺失的『领域操作』层」正是本 module 要补的那一层）、ADR-006（JWT 最小化 / 权限在 Redis）
> 词汇：module / interface / seam / leverage / locality（codebase-design）

## 一、问题总结

「权限决策变了 → 受影响用户必须重新拿到权限」这件事由两个动作组成，且**必须成对**：

1. **撤销其 Access Token**（jti 黑名单）—— 强制重登
2. **主动刷新其权限上下文缓存** —— 下一次请求立即看到新权限

但这一对动作**没有 module**，由 6~8 个写点各自手写配对，且四种形态并存：

| 站点 | 当时形态 |
|---|---|
| `permissions/actions.ts` `invalidateAffectedUsersCache` | refresh → revoke |
| `permissions/actions.ts` `deletePermissionAction` | refresh → revoke（**第二份拷贝**） |
| `roles/actions.ts` `invalidateRoleBoundUsersCache` | 只 refresh（返回 ids 给调用方） |
| `roles/actions.ts` `updateRoleAction` | refresh + **条件** revoke |
| `roles/actions.ts` `deleteRoleAction` | refresh → revoke（**第三份拷贝**） |
| `users/actions.ts` `updateUserAction` | refresh + **条件** revoke（这一次是反序的首半） |
| `users/actions.ts` `deleteUserAction` | revoke → refresh（**反序**） |
| `users/[id]/roles/route.ts` POST / DELETE | refresh → revoke（**第四、五份拷贝**） |

**顺序是隐式知识**（反序与正序并存且都"能跑"），**配对是隐式纪律**（漏掉一半没有任何信号），
而两个批量原语的返回值在**全部**调用点被丢弃。这正是 ADR-019 诊断的「缺失的领域操作层」——
它当时被用来解释 Controller 行数，但那一层始终没有落点。

### 两个「受影响用户集」不是同一个概念（对评审报告的更正）

评审报告称 `getRoleBoundUserIds` 与 `getAffectedUserIds` 是"两个名字、两处 SQL、同一角色"。
**逐行核对后不成立**：

- `getRoleBoundUserIds(roleId)`：`userRoles WHERE role_id = ?` —— 按**角色**求
- `getAffectedUserIds(permId)`：`userRoles ⋈ rolePermissions WHERE permission_id = ?` —— 按**权限**求

两者是**不同的受影响集合**（改一个角色 vs 改一个权限），因此本候选**只收口"施加效果"，
不合并查询**。这一点写在注释里，以免下一位读者把它们当成重复代码合并掉。

## 二、修复方案

新建 `lib/auth/authorization-effects.ts`（按 `portal-architecture-guidelines.md` 的
「领域操作（编排）：`lib/<area>/<operation>.ts`」），只暴露两个具名动词：

| 动词 | 何时用 | 内部动作 |
|---|---|---|
| `revokeAndRefreshAuthorization(userIds)` | 权限**决策**变了（角色/权限/部门归属） | 撤销 AT → 刷新缓存 |
| `refreshAuthorizationCache(userIds)` | **不改变决策**（角色/权限改名、描述） | 只刷新缓存 |

调用方只需回答一个问题：这次变更改变权限决策了吗？——`permissionChanged`
（`hasRolePermissionImpact`）与 `deptIdChanged`（`hasDeptChanged`）都是**领域函数算出来的**，
Controller 只据此选动词，仍然是「编排 + 映射」。

**为什么是两个具名动词而不是一个布尔参数**：沿用本仓纪律（
`docs/solution/2026-09-30-rt-revocation-module-consolidation.md`：维度用函数名编码）——
`skipRevoke: true` 这种参数在调用点读不出语义，而且默认值会变成隐式的第五种形态。

### 顺序为什么固定为「先撤销、后刷新」

撤销是**安全相关**动作（决定用户还能不能用旧凭据），刷新是**缓存性**动作（ADR-011 fail-open）。
两者都失败时，先撤后刷至少让"强制重登"生效；而重新登录时 token 签发路径会预填充权限缓存
（`revokeAllRefreshTokens` → 重新登录 → `rotateRefreshToken`），因此这个顺序在部分失败下**自愈**。
反过来若撤销失败，旧 AT 会继续可用至自然过期——那是两者中更坏的一种残留。

### 失败信号

`revokeAndRefreshAuthorization` 返回 `{ users, atRevokeSucceeded, atRevokeFailed, cacheFailed }`；
`refreshAuthorizationCache` 返回 `{ users, cacheFailed }`——**两个结果类型分开**，因为
"撤销未尝试"与"撤销失败 0 个"必须是两件事（R3 的教训：多义的基本类型等于在 interface 上
删掉了失败这一维）。模块**自己不打日志**：两个批量原语各自记录自己的成败与计数（谁拥有该知识谁记录）。

## 三、同类普查（本仓纪律）

普查全部「撤销 + 刷新」出现处，逐条判定是否属于本概念：

| 站点 | 处置 | 理由 |
|---|---|---|
| 上表 8 处 | 迁入 module | 权限决策变更的收敛动作 |
| `users/actions.ts` `toggleUserStatusAction` | **不动**（只撤销、不刷新） | 账号状态变更是**账号生命周期**，不是权限决策变更；刷新缓存也无意义（禁用后 `getUserPermissionContext` 返回 denied(inactive)） |
| `users/[id]/reset-password/route.ts` | **不动** | 那是**密码重置的会话终止**（RT + AT 两层），与"权限决策变更"是两件事；把塞进来的话 module 的名字会撒谎 |
| `users/[id]/force-logout/route.ts` | 不动 | 管理员强制下线：撤销 + 清缓存（`clearUserPermissionCache`），语义是下线而非授权收敛 |
| `logout` / `change-password` | 不动 | 会话终止 |

**结论**：同类缺陷 8 处全部收敛；另外 4 类"看起来像"的站点逐条给出不改的理由。

## 四、验证

### 变异验证（两条不变量各测一次）

**变异 A：顺序颠倒（refresh 提到 revoke 之前）**

```
× **顺序固定：先撤销（安全相关）后刷新（缓存性）**
× **绑定用户必须同时被撤销与刷新**（配对由 module 保证，不靠调用点记得）
Tests  2 failed | 13 passed (15)
```

**只有顺序敏感的两条变红**；「两个动作成对发生」保持绿——顺序颠倒不破坏配对，测试组能分辨这两件事。

**变异 B：只撤不刷（历史四形态之一，此前完全无声）**

```
× **两个动作成对发生**
× **绑定用户必须同时被撤销与刷新**
× **顺序固定：先撤销、后刷新**
× 成败计数如实映射
Tests  4 failed | 11 passed (15)
```

——「只撤不刷」这一**曾经完全无声**的形态，现在被两条**独立**测试（module 级 + 端到端级）同时抓住。
两次变异后哈希均逐字还原（`02fa5470ffc577fa…9563d4`）。

### 又一次 partial mock 教训（与 R2 同源）

迁移后 `user-role-api.test.ts` 与 `user-api.test.ts` 变红，报
`No "revokeUsersAccessByUserId" export is defined on the "@/lib/session/revoke" mock`——
两个文件的部分 mock 只列了**单用户**原语，而路由现在经 module 走**批量**原语，未列出的导出变成
`undefined`（`CODING_STANDARDS.md` §2 记录过的坑，本轮第二次踩到）。修法一律是
`importOriginal()` + spread + 显式补上真正被调用的导出，并把这次的原因写进注解理由。

另：给 mock 注解下多写一行说明注释会被 `module-mock-guard` 判为**孤儿注解**（它要求注解紧贴
`vi.mock(`）——说明必须折进注解理由本身。

### 门禁

| 门禁 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错误 |
| `eslint`（改动文件） | 0 error、0 warning |
| `pnpm test` | **83 文件 / 703 用例全绿**（修复前 82 / 696） |

## 五、最佳实践（可复用）

1. **"成对的动作"必须有 module，否则配对只是纪律。** 一个动作漏掉另一半时没有任何信号，
   而四种形态能长期并存恰恰证明"能跑"不等于"正确"。判据：如果 A 与 B 总是一起出现，它们
   就是一个概念，应该有一个名字。
2. **顺序要写进 implementation 并给出理由，不要留给调用点。** 反序与正序都能跑，所以顺序
   是**隐式知识**；隐式知识会随调用点数量漂移。写理由（本例：安全相关动作优先，且在部分失败下自愈）。
3. **收口之前先核对"看起来重复"的东西是不是同一概念。** 评审报告说两个受影响用户集是同义，
   逐行核对后是「按角色」与「按权限」两个不同集合——合并它们会引入真 bug。**报告也是二手材料。**
4. **结果类型按"是否尝试"拆开。** 只刷缓存的动词不该返回 `atRevokeFailed: 0`——那是把
   "没尝试"和"尝试后失败 0 个"混成同一个值，正是 R3 修掉的那类多义。
5. **partial mock 是本仓最高频的自伤。** 本轮第二次踩到同一条：改动调用链后会调用**另一批**
   导出，而 mock 里没列。对策固定为 `importOriginal()` + spread，并在注解理由里写明原因。
