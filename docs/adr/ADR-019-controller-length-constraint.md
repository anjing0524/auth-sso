# ADR-019: Controller 行数约束 —— 修正未强制且与配置矛盾的规范

| 属性       | 值                                                                    |
|------------|-----------------------------------------------------------------------|
| **状态**   | accepted (2026-10-08) —— 决策已定；完整实施（12 个 Controller 的领域层抽取）分阶段进行 |
| **日期**   | 2026-10-08                                                            |
| **决策者** | Auth-SSO 团队（improve-codebase-architecture 架构评审候选 ⑦）          |
| **影响范围** | `AGENTS.md`、`docs/portal-architecture-guidelines.md`、`eslint.base.mjs`、22 个 Controller |

## 背景：一处文档化 4 次、声称被强制、实际门槛是文档值 4 倍的约束

| 位置 | 内容 |
|---|---|
| `AGENTS.md:131` | "Controller 函数 ≤20 行，不包含业务逻辑判断" |
| `docs/portal-architecture-guidelines.md:65` | "所有控制层函数体不超过 20 行，不包含一行业务逻辑判断" |
| `docs/portal-architecture-guidelines.md:546` | "函数体 ≤ 20 行" |
| `docs/portal-architecture-guidelines.md:755` | 表格「约束」列写 **`max-lines-per-function`** —— 即声称由该 lint 规则强制 |
| `eslint.base.mjs:24` | 实际：`["warn", { max: 80, skipBlankLines: true, skipComments: true }]` |

**后果**：22 个 Controller **没有一个**触发该规则（22 条 `max-lines-per-function` 告警全部来自组件与页面）。文档在承诺一个不存在的门禁，且门槛（80）是文档值（20）的 4 倍。

这不是"要不要放宽"的问题，而是**规范与配置互相矛盾且都未被执行**。

## 实测：违规是实质性的，不存在临界超标

按 lint 自己的计数口径（`skipBlankLines` + `skipComments`，即**逻辑行**）：

| 逻辑行区间 | 数量 | 说明 |
|---|---|---|
| 21–26 | **0** | **断层** |
| 27–30 | 3 | `deleteUserAction`(28)、`createDepartmentAction`(28)、`deleteRoleAction`(27) |
| 31–38 | 9 | `resetPasswordAction`(38)、`updateUserAction`(36)、`deleteDepartmentAction`(35)、`createUserAction`(33)、`createRoleAction`(33)、`updateRoleAction`(32)、`toggleUserStatusAction`(32)、`changeOwnPasswordAction`(32)、`unlockUserAction`(31) |

**没有 21–26 之间的用例**：每个违规都是 27 行以上的实质性超标。这排除了两种轻率解释——"只是稍微超一点"与"删掉注释就合规"（注释本就不计入）。

## 根因：缺失的「领域操作」层

读代码后的判断：这些 Controller 各自内联了**一个领域操作的完整步骤序列**。以 `changeOwnPasswordAction` 为例，它做的事是：

> 校验入参 → 加载用户 → 验证旧密码 → 检查密码复用 → 哈希新密码 → 计算新历史 → 更新 → 撤销全部会话 → 返回

这是**一个**业务操作（改密），被展开在编排层。项目里有深的读 module（`data.ts`）、深的授权 module（`lib/authz`）、深的 grant module（`oauth-grant.ts`）——**但没有"领域操作"这一层**。

因此"Controller 写太长"是症状，根因是**该被命名为 module 的业务操作没有名字**。

## 决策

### 1. 承认现状：约束未被执行，且配置与文档矛盾

删除 `docs/portal-architecture-guidelines.md:755` 表格里 "`max-lines-per-function`" 这一声称——它描述了一个不存在的门禁。**规范不得声称由工具强制，除非该工具确实以该阈值运行。**

### 2. 区分「委托型」与「编排型」Controller，给不同上限

单一阈值对两类函数不成立：

- **委托型**（薄 Controller：校验 → 调用一个具名 module → 映射响应）：仍适用 **≤20 行**。这类函数没有理由更长。
- **编排型**（在一个事务内协调多个步骤：守卫 + 领域转换 + 持久化 + 副作用）：上限 **≤30 逻辑行**。

**阈值取 30 的依据**（不引用无法核实的外部数字，只依据本仓库的实测）：
- action 侧断层在 26/27 之间，30 落在"实质性超标"区间的下沿。
- 30 逻辑行在 `skipBlankLines`+`skipComments` 口径下，扣掉声明式的 options 对象（`withScopedRow` 的目标配置约占 8–10 行），留给真实步骤的空间仍然很小。
- **已知取舍**：3 个 27–28 行的 action 被放行。它们各自只做一个资源的一次写操作，30 行内的编排是合理的；强行压到 20 只会制造更多无名的中间函数。
- **已知不足**：route 侧有 10 个函数在 34–75 行之间，远超 30。它们是真违规，不是阈值问题；本 ADR 让它们**可见**，修复属分阶段工作。

### 3. 让约束真正被强制 —— 按目录作用域，而非全局收紧

**一次判断失误值得记录**：我最初把 `eslint.base.mjs` 的全局阈值从 80 改为 30，结果告警从 22 涨到 **102**（净增 80）——因为该规则会同时作用于组件与页面等"宽类"函数。这与"只约束 Controller"的意图不符。

正确做法是**按目录作用域施加**：在 `apps/portal/eslint.config.mjs` 为
`src/app/**/actions.ts` 与 `src/app/api/**/route.ts` 单独设 `max: 30`，
基础规则的 80 保持不变（组件与页面不被牵连）。

实测该作用域下被标出的超标函数为 **18 个**（不只是 12 个 action，还有 8 条 route，
其中包含 `performRevocation`、`issueCodeAndRedirect`、`handleFullParamsBranch`
这类"藏在 route 文件里的无名领域操作"——正是本 ADR 根因诊断的实例）。
净增告警约 15 条，而非全局收紧的 80 条。

### 4. 方向：补上「领域操作」层，而不是削行数

**把削到 20 行当作目标会走向错误的方向**——它产生更多无名的中间函数，而不是更清晰的 module。真正让 Controller 变薄的方式是给领域操作起名字：

- 领域决策（纯逻辑）→ `domain/<area>/…`
- 操作编排（I/O + 事务 + 副作用）→ 与 `oauth-grant.ts` 同层的 `lib/<area>/…`

这一步**分阶段进行**，不在本 ADR 内一次完成 12 个；先做试点验证方向。

## 试点验证（2026-10-08）

用 `changeOwnPasswordAction` 验证"补领域操作层"这一方向，而非直接削行数。

**结果：逻辑行 32 → 20**，恰好达到"委托型 ≤20"的上限，且不再触发 30 行规则。
Controller 现在读作：

```ts
const result = await changeOwnPassword(ctx.userId, v.data.currentPassword, v.data.newPassword);
if (!result.ok) { /* 映射 user_not_found → 404 / 其余 → 验证错误 */ }
return { success: true, data: { id: ctx.userId }, message: '密码已更新，请重新登录' };
```

**这验证了根因诊断**：变薄是"给操作起名字"的自然结果，不是削出来的——Controller 里
没有留下一层无名中间函数。若抽完仍接近 30 行，则说明诊断错误；实测未发生。

分层落点（沿 `domain/auth/login.ts` 的既有先例）：

| 关注点 | 位置 |
|---|---|
| 纯判定（同步、无 I/O、抛 DomainError） | `domain/auth/password-change.ts` |
| bcrypt 比对/哈希 + DB + 会话撤销编排 | `lib/account/change-password.ts` |

**为什么判定在 domain 而非 `lib`**：`domain/auth/login.ts` 已有同构先例——
纯判定抛 `DomainError`，由 `mapDomainError` 统一映射；异步 bcrypt 与 DB 留在外层。
把 bcrypt 移入 domain 会违反"domain 层纯 TS"的既有约束。

## 后果

**收益**
- 消除"文档声称强制、实际未强制"的矛盾——这类矛盾比阈值本身更有害，因为它让 reviewer 以为门禁存在。
- 阈值来自实测断层而非外部数字，且注明依据。
- 明确区分两类函数，避免用单一数字粗暴对待不同职责。

**代价与已知局限**
- **本决策不解决根因**。12 个超标 Controller 仍在；30 只是让违规可见并划出合理边界。
- 3 个 27–28 行的编排型 Controller 被放行，属刻意取舍。
- 完整根因修复（领域操作层）是分阶段工作，未完成的控制器仍偏长。

**未采纳的替代方案**
- **放宽到 80 行以匹配 lint**：等于承认约束作废，但会丢掉"委托型应保持薄"这一有价值的部分。
- **强制 20 行**：需为 12 个 Controller 各造 1–2 个中间函数，产生的是无名间接层而非清晰的 module。
- **改用认知复杂度（Cognitive Complexity）阈值**：更贴近"复杂度"而非"长度"，是长期更优的度量。但本仓库当前未引入 `eslint-plugin-sonarjs`，且在缺一手来源核实推荐阈值前不引数字，故**记为待评估项**而非本次决策。

## 相关 ADR

- ADR-017: 授权码兑换深 module（同一手法：把领域操作收成具名 module，路由退化为协议适配——本 ADR 的方向先例）
- ADR-014: 数据范围授权门面（提供了 `withScopedRow` / `withScopedWrite`，使编排步骤本身变小）
- ADR-018: 权限上下文故障分级（另一处"文档与实现不一致"的修复先例）
