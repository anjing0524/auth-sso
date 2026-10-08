# ADR-019: Controller 行数约束 —— 修正未强制且与配置矛盾的规范

| 属性       | 值                                                                    |
|------------|-----------------------------------------------------------------------|
| **状态**   | **superseded in part (2026-10-08)** —— 「编排型 ≤30 逻辑行」这一阈值已被一手来源调研推翻，改为复杂度约束；见「修订」节与「候选 ⑦ 的收口」节 |
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

> ⚠️ **本节（含第 3、4 节）已被下方「修订」节推翻。** 保留原文是为了记录当时的
> 推理链与它错在哪里；**以「修订」节的决策为准**。修订后不设行数上限。

单一阈值对两类函数不成立：

- **委托型**（薄 Controller：校验 → 调用一个具名 module → 映射响应）：仍适用 **≤20 行**。这类函数没有理由更长。
- **编排型**（在一个事务内协调多个步骤：守卫 + 领域转换 + 持久化 + 副作用）：上限 **≤30 逻辑行**。

**阈值取 30 的依据**（不引用无法核实的外部数字，只依据本仓库的实测）：
- action 侧断层在 26/27 之间，30 落在"实质性超标"区间的下沿。
- 30 逻辑行在 `skipBlankLines`+`skipComments` 口径下，扣掉声明式的 options 对象（`withScopedRow` 的目标配置约占 8–10 行），留给真实步骤的空间仍然很小。
- **已知取舍**：3 个 27–28 行的 action 被放行。它们各自只做一个资源的一次写操作，30 行内的编排是合理的；强行压到 20 只会制造更多无名的中间函数。
- **已知不足**：route 侧有 10 个函数在 34–75 行之间，远超 30。它们是真违规，不是阈值问题；本 ADR 让它们**可见**，修复属分阶段工作。

### 3. 让约束真正被强制 —— 按目录作用域，而非全局收紧

> ⚠️ 已被修订节推翻（该目录作用域规则已撤回）。

**一次判断失误值得记录**：我最初把 `eslint.base.mjs` 的全局阈值从 80 改为 30，结果告警从 22 涨到 **102**（净增 80）——因为该规则会同时作用于组件与页面等"宽类"函数。这与"只约束 Controller"的意图不符。

正确做法是**按目录作用域施加**：在 `apps/portal/eslint.config.mjs` 为
`src/app/**/actions.ts` 与 `src/app/api/**/route.ts` 单独设 `max: 30`，
基础规则的 80 保持不变（组件与页面不被牵连）。

实测该作用域下被标出的超标函数为 **18 个**（不只是 12 个 action，还有 8 条 route，
其中包含 `performRevocation`、`issueCodeAndRedirect`、`handleFullParamsBranch`
这类"藏在 route 文件里的无名领域操作"——正是本 ADR 根因诊断的实例）。
净增告警约 15 条，而非全局收紧的 80 条。

### 4. 方向：补上「领域操作」层，而不是削行数

> 本节的**根因诊断未被推翻**（抽取领域操作仍有价值：可命名性、可测性、职责），
> 但它**不是修复违规的必要手段**——修订后这些 Controller 不再违规。

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

## 修订（同日，基于一手来源调研）

上文的「编排型 ≤30 逻辑行 / 委托型 ≤20 行」双阈值被后续调研**推翻**。调研用 TypeScript
编译器 API 只读解析了 22 个 Server Action，得到两个决定性事实：

### 事实一：这条约束测错了对象

| 指标 | 实测 |
|---|---|
| 整段 action 的**圈复杂度** | **最大 8**，仅 2 个 > 5，**0 个 > 10** |
| 最大嵌套深度 | 3 |
| 超 20 逻辑行的 14 个中 | **12 个圈复杂度 ≤ 5** |
| `withScopedWrite/withScopedRow` 的声明式守卫 spec 占比 | **18% 逻辑行** |

**长度来自声明式配置与多行参数，不是逻辑。** 这直接解释了本 ADR 上文那个困惑
——"抽出两轮重复模式后 18→19"：每引入一个编排原语都在函数体里加行，**重复度降了
而行数不降，因为度量与目标正交**。

### 事实二：权威来源反对硬性行数上限

| 来源 | 表述 |
|---|---|
| Google C++ Style Guide | "**no hard limit** is placed on functions length. If a function exceeds about 40 lines, think about whether it can be broken up" |
| Ousterhout（APoSD） | "Setting **arbitrary numerical limits** such as 2-4 lines in a method … **exacerbates this problem**" |
| Fowler《FunctionLength》 | "This is a **proxy** for the more important question…" / "**size isn't important**" |
| Clean Code 作者本人 | "It is certainly possible to **over-decompose** code" / "I claimed **no final authority**" |
| Hatton 1997（DOI 10.1109/52.582978） | 缺陷密度呈 **U 形**，**中等组件比小或大组件更可靠**——直接反证"越短越好" |
| Linux 内核风格 | 长度上限与"复杂度与缩进层级"成反比；概念简单则可长 |
| Next.js / NestJS / Rails 官方 | 对 handler 只定义**职责**（未信任入口、鉴权、校验入参），**从不设行数** |

工具默认值跨度达 5 倍（ESLint 50 / CodeScene 70 / Checkstyle 150 / SonarJS 200），
Airbnb 直接设为 `off`。**不存在"业界通行阈值"这回事。**

### 修订后的决策

1. **唯一硬性约束是职责**，不是长度：Controller 不得出现业务规则判定；必须经
   `withAuth` + `validate()` + `withScopedWrite/withScopedRow`；多表写入同一事务。
2. **复杂度由工具强制**：`complexity: 10`（对齐 PMD 默认）、
   `sonarjs/cognitive-complexity: 15`、`max-depth: 4`、`max-params: 4`。
3. **物理行仅作软兜底**：`max-lines-per-function: 150`（逻辑行，跳空行与注释）。
   依据：Checkstyle 默认 150、SonarJS 200、本项目实测最大 40 逻辑行 → 只拦真正
   失控的过程式长函数。
4. **豁免**：无分支的纯顺序编排函数（cyclo ≤ 3 且嵌套 ≤ 1）不受行数限制。

**迁移成本 0 行代码**（实测 22 个 action 全部通过），只需改配置与文档。

### 落地实测（2026-10-08）

配置已改：`eslint.base.mjs` 加 `complexity: ["warn", 15]`、`max-depth: ["warn", 4]`，
`max-lines-per-function` 由 `80` 放宽为 `150`；上文的目录作用域 30 行规则已撤回。

| 指标 | 改动前 | 改动后 |
|---|---|---|
| lint 告警总数 | 104 | **81** |
| lint 错误 | 0 | **0** |
| 新增复杂度类告警 | — | **10**（其中 5 条落在测试夹具与脚本；5 条落在生产代码） |

**刻意不引入 `max-params`**：实测其违规全部是"恰好 5 参数"的既有工具函数
（`withPagination`、`verifySignature`、`paginatedSelect` 等），改造属纯负担、收益不明。

**刻意不引入认知复杂度**：需新增 `eslint-plugin-sonarjs`，而其 `recommended` 预设会把
几乎所有规则设为 `error`（存量爆噪音），必须逐个手动开启；且该度量的独立学术验证
不完整。记为**待评估项**。

被新门槛标出的 5 处生产热点（**保留为待修，不静默豁免**）：

| 位置 | 问题 |
|---|---|
| `api/auth/logout/route.ts:36` `performRevocation` | complexity 23 |
| `api/permissions/register/route.ts:56` | complexity 29 |
| `app/(dashboard)/layout.tsx:20` `DashboardContent` | complexity 16 |
| `api/auth/logout/route.ts:51` | 嵌套 5 层 |
| `lib/auth/token/signing-keys.ts:141` | 嵌套 5 层 |

**一处需要说明的判断**：`performRevocation` 的 23 来自 **5 段各自独立的 try/catch**
（每步失败不影响其余，是刻意的优雅降级设计）。拆开它会破坏该设计——这是"复杂度指标
把刻意为之的结构算作复杂"的实例，也是本 ADR 承认认知复杂度"学术验证不完全"的具体注脚。
故**保持现状并在此登记**，而非为降低指标而改动正确代码。

### 放弃的东西（如实记录）

- 放弃"零工具依赖、一眼可读"的自律信号，改用需学习成本、可被技巧规避的复杂度指标。
- 放弃对长篇过程式逻辑的强兜底（150 行比 20 行宽松 7.5 倍）。
- 放弃可移植性（阈值绑定工具，换工具需重新标定）。
- **接受一个学术验证不完整的度量**：认知复杂度由 SonarSource 自研，其白皮书**全文
  没有推荐阈值**（15 全部来自工具默认），独立实证（Costagliola et al. 2022）未能取得。
  应标注为"业界共识较强、学术验证不完全"。

### 保留有效的部分

上文「根因是缺失的领域操作层」这一诊断**未被推翻**，且被试点验证（见下节）。
抽取领域操作仍然有价值——理由是**可命名性、可单测性与职责**，而**不是**为了压行数。

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

## 候选 ⑦ 的收口（2026-10-08）

架构评审候选 ⑦ 的原始表述是"写路径编排在 22 个 Controller 里重复，17 个超出 20 行上限"。
经本 ADR 的决策后，该表述的**前提已不成立**，需明确收口如下。

### 实测：11 个"长"Controller 没有任何一个违反现行门槛

按逻辑行（去空行与注释）计，仍有 11 个 Controller > 20 行：

| 逻辑行 | Controller |
|---|---|
| 38 | `resetPasswordAction` |
| 36 | `updateUserAction` |
| 35 | `deleteDepartmentAction` |
| 33 | `createUserAction` / `createRoleAction` |
| 32 | `updateRoleAction` / `toggleUserStatusAction` |
| 31 | `unlockUserAction` |
| 28 | `deleteUserAction` / `createDepartmentAction` |
| 27 | `deleteRoleAction` |

但这 11 个**全部通过**现行门槛（`complexity ≤ 15`、`max-depth ≤ 4`、`max-lines ≤ 150`），
实测触发数为 **0**。

**结论：它们不是违规。** 行数上限已由本 ADR 的修订移除，而"20 行"从来不是复杂度的
有效代理（见「修订」节的实测数据：这批 Controller 的最大圈复杂度远低于门槛）。

### 已完成的部分

| 项 | 结果 |
|---|---|
| 写后缓存失效收口 | 51 处手写 → 1 个原语 + 21 处调用（commit `968ae60`） |
| 安全写编排收口 | `withScopedRow` / `withScopedWrite` + `preflight`；`requireDeptAccess` 调用点 12 → 0（commit `3deca95`） |
| 约束本身的修正 | 行数上限移除，改复杂度门槛；文档与配置对齐（commit `6103c9b`） |
| 领域操作层方向验证 | `changeOwnPasswordAction` 32 → 20 逻辑行，**不产生无名中间函数**（commit `6da98f3`）。该 action 现为 `lib/account/change-password.ts` 的 `changeOwnPassword`；`resetPasswordAction` 的同法抽取见 commit `629dc38` |

### 第三轮：实测剩余重复，据此收口（2026-10-08）

code review 的 Spec 轴指出⑦"以撤掉标尺代替达标"。据此做了直接实测，而不是继续论证：

**① 领域操作已经存在。** 11 个超标 Controller 各自**只调用一个**领域函数
（`createUser` / `toggleUserStatus` / `applyRoleUpdate` / `validateDepartmentDeletable` …），
再落库。再抽一层只会产出"纯粹转发的中间人"——正是评审基线里的 **Middle Man**。

**② 重复确实存在，但只在 `users/actions.ts`。** 逐字比对 `withScopedRow` 的
options 块：users 有 **3 处逐字相同**（另 2 处为合理变体：一处加迁移目标、
一处选列收窄）；而 **roles / departments 各 3 块、重复 0 组**。

**③ 据此抽取（已实施）。** 新增 `loadUserScoped(operatorId, userId, selectColumns?)`，
把这份**安全配置**（授权到 `deptId`、越界消息、404 语义）收为一处。抽取理由是
正确性而非行数：守卫配置散落时，改一处而漏改另一处即越权；收成一处才能保证
"改则全改"。效果：

| Controller | 逻辑行 |
|---|---|
| `toggleUserStatusAction` | 34 → 26 |
| `unlockUserAction` | 33 → 25 |
| `deleteUserAction` | 30 → 22 |
| `updateUserAction` | 38 → 32 |

**④ 剩余 7 个不再抽取。** 它们的长度来自 `withScopedRow` 的**声明式变体**
（每个 Controller 的守卫目标与列选择各不相同）与 Zod 校验、响应映射。实测重复为 0，
故抽取收益为负（换来的是 Middle Man）。

### 未做且**不应**作为"违规修复"继续做的部分

剩余 11 个 Controller 的领域操作抽取（`resetPassword`、`user` CRUD、`role` CRUD、
`department` CRUD）**不是合规工作**。若继续做，理由必须是它们自身的价值：

- **可命名性**：`resetPassword` 是一个业务操作，目前被展开在编排层。
- **可单测性**：纯判定（如密码复用、状态机转换）可脱离 PingServer Action 单测。
- **职责**：Controller 只做"编排 + 映射"。

**若没有这些理由，为压行数而抽取是净负收益**——它产生无名的中间函数（本 ADR
"未采纳的替代方案"一节已记录该判断）。

### 第二个试点：**证伪了"抽取领域操作即可让 Controller 变薄"的推广**

用 `resetPasswordAction`（38 逻辑行，最长的一个）做第二个试点，按同一模式抽出
`lib/account/reset-password.ts`（`assertResetAllowed` / `hashNewPassword` /
`buildPasswordHistory` / `revokeAfterPasswordReset`，复用 `domain/auth/password-change.ts`
的既有判定）。

**结果：38 → 35 逻辑行。几乎没有变薄。**

与第一个试点（`changeOwnPasswordAction` 32 → 20）的差异有明确原因：

| | changeOwnPassword | resetPassword |
|---|---|---|
| 主体构成 | 一整段密码操作序列（验证旧密码 → 复用检查 → 哈希 → 历史 → 落库 → 撤销） | `withScopedRow` 的**声明式 options 块**（约 14 行）+ Zod 校验 + 响应映射 |
| 可抽取的领域序列 | 有，且很长 | **没有**——重复已被 `withScopedRow` / `invalidateResource` 两刀消除 |

**所以第一个试点的成功不能推广。** "给领域操作起名字"只在 Controller 里**确实存在
一段未命名的领域序列**时才让函数变薄；当主体是声明式配置时，抽取只是把配置搬到
别处。这正好印证了调研的实测发现——**长度来自声明式配置与多行参数，不是逻辑**。

因此本 ADR 的"修订"一节对行数的判断成立，而"根因诊断"只在部分 Controller 上成立。
两者都需要如实记录，而不是用成功的那个试点代表全部。

### 附带发现：该 action 此前**零测试覆盖**

`resetPassword` 是安全关键操作（改他人密码 + 撤销会话），却没有任何测试，
其中 NFR-SEC-15 的密码复用判定从未被验证。已补 5 例（有效输入、弱密码、
**命中历史必须拒绝且不落库**、目标不存在 404、成功后撤销会话），并做变异验证
（去掉复用判定 → 对应用例变红）。

### 一个仍然真实的观察

这 11 个 Controller 中，多数共享同一种形状：
`validate → load row (404) → scope guard → domain transition → persist → revoke/invalidate → respond`。
这个形状已被 `withScopedRow` / `withScopedWrite` / `invalidateResource` 覆盖了大部分，
剩下的差异在**领域转换本身**。因此进一步抽取的收益主要在"给领域转换起名字"，
而不在删除重复——**重复已经被前两刀删掉了**。

## 相关 ADR

- ADR-017: 授权码兑换深 module（同一手法：把领域操作收成具名 module，路由退化为协议适配——本 ADR 的方向先例）
- ADR-014: 数据范围授权门面（提供了 `withScopedRow` / `withScopedWrite`，使编排步骤本身变小）
- ADR-018: 权限上下文故障分级（另一处"文档与实现不一致"的修复先例）
