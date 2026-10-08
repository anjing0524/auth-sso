# ADR-014: 数据范围授权收敛为单一门面（PEP）—— executor-first、写路径 transaction-only、不上 RLS

| 属性       | 值                                                                    |
|------------|-----------------------------------------------------------------------|
| **状态**   | implemented (2026-10-08) —— 6 个步骤全部落地；唯一遗留见"实施顺序"第 4 步注 |
| **日期**   | 2026-10-08                                                            |
| **决策者** | Auth-SSO 团队（improve-codebase-architecture 架构评审候选 ② + 一手来源调研定案） |
| **影响范围** | `lib/auth/data-scope.ts`、4 个 `(dashboard)/**/data.ts`、9 条写路径 route、16 处 Server Action、`lib/auth/index.ts` 公开面 |

## 背景

数据范围（OBAC，ADR-002）规则是：**用户可访问的部门 = 其所有 ACTIVE 角色所属部门的子树并集**。它同时用于读路径（列表过滤）与写路径（越界拦截 403）。2026-10-08 架构评审（候选 ②）复核时，该规则以两种不兼容的形状散落在 28 个调用点，并暴露出三处真实缺陷：

### 1. fail-open（已修复，本 ADR 记录教训）

`(dashboard)/roles/data.ts` 的 `buildRoleConditions(keyword, status, deptIds?)` 把 `deptIds` 设为**可选**，只在 `deptIds && deptIds.length > 0` 时追加过滤：

```ts
// 修复前
if (deptIds && deptIds.length > 0) {
  conditions.push(inArray(schema.roles.deptId, deptIds));
}
```

于是**省略 `deptIds` ⇒ 不产生任何范围条件 ⇒ 返回全部部门的角色**（含其他部门的角色名与编码）。这与同日历 `db/user-queries.ts` 的 fail-closed 实践（空范围追加 `sql\`FALSE\``）直接矛盾。

危险性的关键在于**签名暗示它做了过滤**：调用者看到 `deptIds?` 会理解为"可选地进一步收窄"，而实际语义是"不传则不做任何限制"。这比"JSDoc 声称有过滤但参数不存在"（`departments/data.ts:60,84`）更危险，因为后者的签名至少没有做出承诺。

当前 REST 路径（`api/roles/route.ts`）与 Server Component（`roles/page.tsx`）都传了 `deptIds`，所以未在生产暴露；但任何未来新增的调用点都会静默拿到全系统角色。

### 2. TOCTOU：3 条写路径中招（读取守卫另有 5 处形状 B）

REST 侧 13 处手写守卫中，**8 处**的 operator 范围快照取自事务外。按是否伴随写入区分，其中 **3 处是真正的 TOCTOU 写路径**，5 处是只读守卫（旧快照只影响读的 403 判定，不产生越权写入；它们属于"形状统一"问题，归步骤 3）：

| 位置 | 类型 | 缺陷 |
|---|---|---|
| `api/users/[id]/roles/route.ts` POST | 写 | 快照在事务外；事务内重读 target 并复用旧快照，制造原子性假象 |
| `api/users/[id]/roles/route.ts` DELETE | 写 | 快照在事务外；事务内复用 |
| `api/users/[id]/reset-password/route.ts` | 写 | 守卫完全在事务外，写事务只包 `passwordHash` |
| `api/users/[id]/force-logout/route.ts` | 写（无事务） | 守卫在事务外，且任何 DB 写入都不在事务内 |
| `api/users/[id]/route.ts`、`api/users/[id]/roles/route.ts` GET、`api/roles/[id]/route.ts`、`api/roles/[id]/permissions/route.ts`、`api/departments/[id]/route.ts`、`api/departments/[id]/members/route.ts` | 只读 | 快照在事务外（读路径无写入，无 TOCTOU，但形状不统一） |

> 计数更正记录：本 ADR 初稿写"9 条写路径中 8 条中招"，是把"手写守卫点位数"与"写路径数"混为一谈的口径错误。真实写路径数是 **4 个**（`roles` POST/DELETE 同属一个文件），其中 **3 个**曾取事务外快照。原调研报告的表格本身是准确的（只读项标注"—"），是本文摘要时的转述错误。

`POST /api/users/[id]/roles` 在事务内**重读 target.deptId** 并再次 `canAccessDept(deptIds, ...)`，制造了原子性的假象——重读的是**被操作对象**，不是**操作者的范围快照**。因此"操作者被降权"这一半完全敞开。

**既有审计文档的"已修复"声称不可信**：`docs/spec-alignment-audit-2026-06-25.md:21` 记 "A3 ✅ 已修复 — 事务内重读 deptId"。该声称覆盖的是 target 侧，不是 operator 侧。本 ADR 据此判定：**"已修复"的审计条目必须指明它覆盖了哪一侧。**

### 3. seam 画错了位置

`canAccessDept(deptIds, targetDeptId)` 是纯函数（`Set.has` 语义），本身是对的。真正需要被隐藏的不变量是「**范围快照的获取与使用必须源自同一执行器**」。当前 `getUserRoleDeptIds` 与 `canAccessDept` 都被 `lib/auth/index.ts:16` 导出，等于把这个不变量交给 28 个调用点各自维护——而 8/13 个 REST 调用点维护失败了。

这一现象的内部证据极强：**同一项目内，两种形状导致了两种正确性**（Action 侧全对、REST 侧 8/13 错）。这证明问题不在开发者疏忽，而在 interface 允许了错误的用法。

## 决策

### 1. executor-first 是正确方向，且不是风格选择（保留并强化）

一手来源背书：Prisma 官方文档有专门的 "Pass `tx` to your helper functions" 与 **"Common mistakes → Querying through `db` instead of `tx`"** 章节，与我们的形状 B 同构；ZenStack 官方文档写明 "employing a transaction is the most reliable way to achieve a consistent result"。

机制在本地依赖中得到验证（`drizzle-orm@0.45.2`，`postgres-js/session.js`）：`db.transaction` 走 `client.begin(...)`，把回调内所有语句钉在**同一条连接**上；事务闭包外的 `db` 走**另一条连接**，立即提交、不随事务回滚。**传没传 executor，决定了同一份代码是原子还是非原子。**

### 2. 写路径收敛为唯一门面，且 handler 只收 `tx` 不收 `db`

新建 `lib/authz/` 作为数据范围授权的唯一门面（PEP）：

```
apps/portal/src/lib/authz/
├── scope.ts       纯函数：Scope 类型 + canAccess()（零 I/O）
├── resolve.ts     I/O：resolveScope(executor, operatorId) -> Scope
├── query.ts       读路径：scopeFilter(scope, column)（空 scope ⇒ sql`FALSE`）
├── write.ts       写路径：assertScope（现 requireDeptAccess 改为 scope-first，模块内私有）
├── with-scoped-write.ts  写入口包装器：事务 + 事务内快照 + 守卫 + 错误映射 + 审计
└── index.ts       只导出 withScopedWrite / resolveScope / scopeFilter / canAccess / Scope
```

**写路径的 handler 只接受 `DbTxHandle`**：把"`db` 与 `tx` 是不同连接"这一源码事实固化为类型约束，写路径**没有机会**误用 `db`。这比 Prisma 的"文档警告"更强——我们在类型上直接禁止。

**快照、目标校验、handler 共享同一个 `tx`**，使"事务外快照"这一形状在结构上不可能再出现。

### 3. `requireDeptAccess` / `getUserRoleDeptIds` / `canAccessDept` 不再从 `lib/auth` 导出

调用面从 28 收缩到 2（`withScopedWrite`、`scopeFilter`）。13 处 REST 形状 B 的代码将在 import 阶段编译失败，被迫改造——这就是"把纪律变成结构"的机制。

### 4. 读路径用 branded `Scope` + `scopeFilter`，可选范围参数一律改为必填

`Scope` 为 branded type（私有构造子），`scopeFilter` 是唯一接受它的过滤构造器；空 scope ⇒ `sql\`FALSE\``。所有 `data.ts` 导出的范围参数由 `deptIds?: string[]` 改为 `scope: Scope`。
`departments/data.ts:60,84` 的 JSDoc 谎话（声称有 `deptIds` 参数但签名里没有）必须删除，或把函数显式改名为 `...Unscoped` 并限制使用点。

### 5. 不上 PostgreSQL RLS（明确否决，记录理由）

RLS 在技术上可表达子树并集（policy + `SECURITY DEFINER` helper），但本仓库不值得，理由是**可复现的技术约束**而非审美：

1. **身份注入必须 `SET LOCAL`**（事务作用域），要求整条 API 是"每请求一事务"的形态——PostgREST 全栈如此。而本仓库读路径是 Next.js RSC + `"use cache"` + `cacheLife('minutes')`，没有这一层；为 RLS 引入它等于给读路径强加事务，与持久化缓存模型冲突。
2. **RLS 不消除 TOCTOU**：PostgreSQL 官方文档在 RLS 章节自己给了一个 policy 子查询在 READ COMMITTED 下产生竞态的完整反例（`ddl-rowsecurity.html`），结论是必须叠加显式锁——又绕回锁。
3. **性能风险落在最坏的一类形状上**：`can_access_dept(dept_id)` 以行信息为入参，**无法**用 `(select ...)` 包成 initPlan，正是 Supabase 官方 RLS 性能指南明确警告"必须实测"的那一类（其 benchmark 中同类写法在 100K~1M 行表上出现 178s / 3min 超时）。
4. **契约冲突**：RLS 把"越权"从 403 变成空集/0 rows，会破坏 `ApiError` 契约与 H-ACL-002 的"拦截"验收语义（`docs/spec/REQUIREMENTS_MATRIX.md:150`）。
5. **唯一入口已在应用内**：`db` 不对外暴露，数据库无第二个直连客户端。

**如果将来出现第二个直连数据库的客户端（BI / Data API / 外部服务），本决策必须重新评估**——本方案对那种场景不提供任何保护。

## 后果

**收益**
- 写路径的"事务外快照"在类型上不可表达；8 条 TOCTOU 缺陷有统一的修复点。
- 范围过滤从"每个查询各自记得"变成"唯一 `scopeFilter` 构造器 + 空范围恒 FALSE"。
- 调用面 28 → 2，security 规则有了单一 locality。
- `Scope`/`canAccess` 为纯函数，可穷举测试，无需 DB。

**代价（显式接受）**
- **放弃了编译期的 secure-by-default**：Drizzle 没有 Prisma middleware / ZenStack 增强客户端那种运行时统一拦截层，`db.select()` 的出口无法从类型上封死。只能靠"门面收口 + branded type + lint 兜底"做**次优强制**。要做到真 secure-by-default 必须整体迁 ZenStack，代价是引入代码生成与 ZModel DSL，与 `AGENTS.md` 的"无 Repository 层 / 架构污染零容忍"及 `"use cache"` 读模型冲突。**这是本 ADR 最重要的 tradeoff。**
- **放弃了 ALS 隐式事务上下文**：每个写操作仍需显式进入 `withScopedWrite`，无法像 Spring `@Transactional` 那样自动传播。理由：Node 官方文档对 `enterWith()` 明确警告"后续事件处理器也会在该 context 中运行"，长生命周期对象持有已提交 tx 的风险不可静态排除，且隐式依赖与"架构清晰"约束方向相反。
- **放弃了 403/404/空集的语义统一**：写路径继续 403（H-ACL-002 验收要求），读路径继续空集/404。同一规则在两种路径上表现为不同错误形态，必须在 API 契约中明写。
- **不解决"跨请求的长事务 vs 操作者降权"**：`withScopedWrite` 只保证单事务内一致。若要更强，需在包装器内对操作者 `user_roles` 行加 `FOR SHARE`，或采用 Serializable + 40001 重试框架。**本期不引入**（重试框架成本 > 收益）。这是可选的局部增强点。

**必须同步的记录**
- `docs/spec-alignment-audit-2026-06-25.md` 的 A3 "已修复"声称需加注：覆盖 target 侧，未覆盖 operator 侧。

## 实施顺序（每步独立可验证）

1. ✅ **修 fail-open**：`roles/data.ts` 的 `deptIds` 改必填 + `sql\`FALSE\`` 兜底；补"空范围即空集 / 范围外不可见"回归测试。**已完成 2026-10-08**，测试经变异验证（移除守卫后确会失败）。
2. ✅ **修 TOCTOU 写路径（3 条）**：
   - ✅ **门面落地**：`lib/authz/{data-scope,write,index}.ts`，含 `resolveScope` / `isWithinScope` / `assertWithinScope` / `withScopedWrite`；9 个门面测试经**真实并发时序**证明"旧形状降权后仍写入成功、门面形状拒绝且不写入"。
   - ✅ **3/3 条 TOCTOU 写路径已迁移**：`users/[id]/reset-password`、`users/[id]/force-logout`、`users/[id]/roles` 的 **POST 与 DELETE**（同一文件两个分支）。
   - ✅ **补了 2 条路由级越界断言**（`user-role-api.test.ts`）：范围外用户 POST/DELETE → 403 且绑定不变。此前该文件只 mock `canAccessDept`，无法区分新旧快照路径。
3. ✅ **收读路径**：
   - ✅ **新增读路径原语** `lib/authz/query.ts`：`scopeFilter(scope, column)` 保证**永远返回一个条件**（范围内 → `IN`，空范围 → `FALSE`），消除 `and()` 无有效条件时返回 `undefined` 导致静默不过滤的 fail-open 形状；`isScopeDenied(scope)` 供查询前短路。
   - ✅ **departments 读模型已迁移**：`getDepartments(scope, …)`、`getDepartmentById(lookupId, scope)`、`getDepartmentMembers(deptId, scope)`；后两者原先**根本没有作用域参数**（JSDoc 却声称"可选：API Route 传入"，属 interface 撒谎），现在范围约束进入 SQL。
   - ✅ **顺带修掉一个真实缺陷**：子树展开谓词漏掉一级子部门（详见下节），它使 `/api/departments` 对真实管理员返回断裂的树。
   - ✅ 5 处只读路由不再手写守卫：范围外与不存在同形返回 404（避免用状态码探测部门是否存在）。
   - ✅ **全部读模型收口为 `Scope`**：`users/data.ts`（`getUsers`）、`roles/data.ts`（`getRoles` / `getRoleById` / `getRolePermissions`）、`dashboard/data.ts`（`getDashboardStats`）、`db/user-queries.ts`（`buildUserListConditions`）。
   - ✅ **顺带修掉第二处 fail-open**：`getDashboardStats` 原先只在 `deptIds` 非空时追加范围条件，空范围会退化为**统计全系统**的用户数与角色数。现改为空范围直接返回全 0（`isScopeDenied` 短路）。
   - ✅ **全部只读守卫统一**：`users/[id]`、`users/[id]/roles` GET、`roles/[id]`、`roles/[id]/permissions`、`departments/[id]`、`departments/[id]/members` 不再手写三连，改由读模型内部 `scopeFilter` 施加；角色详情与权限列表改为"范围外与不存在同形返回 404"。

### 附带修复：子树展开漏掉一级子部门（真实缺陷，非重构副产品）

`ancestors` 的权威语义是**父链、不含自身**（`domain/department.ts` 的 `computeAncestorPrefix`：根 `null`、一级子部门 = 根 ID、二级 = `根/一级`）。但 `getUserRoleDeptIds` 的子树谓词只有：

```ts
eq(schema.departments.id, deptId),
like(schema.departments.ancestors, `${deptId}/%`),   // 只匹配二级及更深
```

**一级子部门的 `ancestors` 恰等于 `deptId`（无末尾 `/`），不匹配 `LIKE 'deptId/%'`**，因此被整体漏掉。后果按角色所在层级不同而不同：角色在一级部门时正常，角色在**根部门**时可见范围漏掉全部一级子部门。

**该缺陷能长期存活的关键原因：它被写进了测试期望。** `data-scope.test.ts` 的"角色 deptId 为根部门 — 子树正确展开"用例注释明写 *"直接子部门(ancestors=ROOT_ID，无末尾'/')不匹配 LIKE 'ROOT_ID/%'"*，并断言结果集**刻意排除** MKT、长度为 4。**把缺陷固化成规范后，任何符合直觉的实现都会让测试变红**，于是 bug 被"保护"了下来。

产物侧的可见症状：`/api/departments` 的 `buildDepartmentTree` 按 `parentId` 嵌套，当中间层（TECH）不在结果集里时，其子部门（FE）因父缺失被当作顶层返回——管理员的部门树出现"前端组"与"总公司"并列。

修复：谓词补 `eq(schema.departments.ancestors, deptId)`（直接子部门），保留 `LIKE`（更深层）。测试期望同步翻转为 `{ROOT, TECH, MKT, FE, BE}` 长度 5。
4. ✅ **关门面**：`lib/auth/index.ts` 不再导出 `getUserRoleDeptIds` / `canAccessDept`。
   - 仅保留 `requireDeptAccess`：它是 executor-first 的，Server Action 侧 16 处调用全部正确；迁移到 `withScopedWrite` 是后续步骤。
   - 撤下后全库对这两个原语的引用降为 **0**（只剩 `lib/auth/data-scope.ts` 自身定义与 `lib/authz` 的内部使用）。
5. ✅ **单一入口检查测试（替代原定的 lint 规则）**：
   - ⚠️ **偏离原计划并说明理由**：原定"禁止在 `app/api/**` 直接 `db.select`"的 lint 规则**被否决**——全库有 **39 个文件**合法导入 `@/infrastructure/db`（其中 13 个做写操作），宽泛禁令需要大范围白名单，噪声大于价值；且 ADR 已明确"Drizzle 无运行时拦截层、这层封不死"。**次优强制不应伪装成强强制。**
   - ✅ 改为**公开面契约测试** `__tests__/api/authz-surface.test.ts`：断言 `@/lib/auth` 不再导出 `getUserRoleDeptIds` / `canAccessDept`，而 `@/lib/authz` 提供 `withScopedWrite` / `resolveScope` / `scopeFilter` 等全部门面原语。**经变异验证**：把 `canAccessDept` 加回 barrel 后测试立即变红。
   - 选择契约测试而非 lint 的理由：**lint 规则可被 `eslint-disable` 绕过，静态契约测试不能**；且它钉住的正是"已撤下"这一事实本身。
6. ✅ **删除 JSDoc 谎话**：`departments/data.ts` 与 `roles/data.ts` 的 4 处"`deptIds` 可选：API Route 传入"（参数并不存在）已随读模型 `Scope` 化一并删除。

### 测试方法说明（可复用）

门面的不变量（"快照与写入同事务"）无法用 mock 证明，必须是**真实并发/可见性测试**。本仓库采用的手法：让"降权事务提交"与"门面内取快照"在时间上明确排序。因为双方都不持有对方所需的锁（`SELECT` 不加锁），该序列等价于并发交错中"降权先提交、守卫后执行"。

必须同时写**对照用例**：用旧形状（事务外快照 + 事务内复用）复现缺陷成功写入，再用门面形状证明拒绝——只有对照存在，测试才证明的是"修复有效"而不是"当前代码能跑"。这与本文`docs/solution/2026-10-08-data-scope-fail-open.md` 中"回归测试必须变异验证"是同一条纪律的两个面。

## 相关 ADR

- ADR-002: 角色-部门绑定（OBAC 数据范围规则的来源）
- ADR-005: 三层安全模型（`withAuth` 定位；本 ADR 补齐其未承载的 OBAC 层）
- ADR-006: JWT 最小化与鉴权分离（权限上下文在 Redis，不在 JWT）
- ADR-011: 故障语义分级（本 ADR 的读路径 fail-closed 与之一致）

## 附：调研未验证条目（不得作为决策依据）

以下条目在本次调研中**未能取得一手来源逐字内容**，故不作为决策依据，仅备查：Keycloak 关于"授权决策与业务写入同事务"的官方立场；Ousterhout《A Philosophy of Software Design》逐字引文（取自公开 PDF 副本）；NIST SP 800-162 正文中 PDP/PEP 的逐字定义（`nvlpubs.nist.gov` 返回 406，仅取到出版物元数据页，DOI `10.6028/NIST.SP.800-162`）；XACML 3.0 §3.1 逐字定义（仅取到搜索片段）；Gary Bernhardt "Boundaries" 一手文字；Uber ABAC 与 Netflix 分布式授权博客正文（JS 渲染页）；`@nestjs-cls/transactional` API 细节；TypeORM `@TransactionManager` 逐字文档；NestJS 核心是否有官方 `@Transactional()`；Node.js "Troubleshooting: Context loss" 逐字内容；PgBouncer 表对 `SET LOCAL` 与 `SET` 的区分（本 ADR 中"transaction pooling 下 `SET LOCAL` 安全"的推论基于 PG 官方 `set_config(is_local=true)` 语义 + PostgREST 实际做法，而非 PgBouncer 逐字陈述）。

**已取得逐字引用的来源**：PostgreSQL 官方（`transaction-iso.html`、`ddl-rowsecurity.html`、`sql-createfunction.html`、`functions-admin.html`）；Prisma Transactions；ZenStack Under the Hood；PostgREST Transactions / Auth / DB Authz；Supabase RLS 与 RLS 性能指南；Hasura Row-Level Permissions；PgBouncer features；Spring Transaction Propagation；Node.js async_context；本地 `drizzle-orm@0.45.2` 源码。
