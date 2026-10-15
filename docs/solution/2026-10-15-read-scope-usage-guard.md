# 读路径数据范围：**不建** seam，改为机械守卫「取了范围就必须用它」（架构巡检候选 3）

> 日期：2026-10-15
> 来源：`/improve-codebase-architecture` 巡检候选 3（`Worth exploring`，建议新增 `readScoped(build)` seam）
> 巡检报告：`docs/architecture-review-2026-10-15.html`
> 结论：**候选的建议未采纳**（附审计证据）；改为落地该候选自己写出的收益之一——一条静态守卫。

## 一、为什么**不**建这个 seam

巡检的论据是："写路径把 `resolveScope` 藏进 module，读路径却导出它，要求 9 个 route +
5 个 data 模块手写同一道工序"。我按 **删除测试** 与**实际审计**核了一遍：

**审计结果（逐个调用点看完）**：`apps/portal/src` 内 `await resolveScope(` 共 **16 处**（9 个 route + 5 个 page + 2 处 `authz/write.ts`）；route 那 9 处**全部**把结果传进了带范围的读函数
（`getUsers` / `getRoles` / `getDepartments` / `getDepartmentById` / `getRoleById` /
`getRolePermissions` / `getUser` / `getUserRoles` …），**没有一处取了不用**；
`data.ts` 一族也都用了 `isScopeDenied` 短路 + `scopeFilter` 造条件 —— 这是 ADR-014 之后
刻意维持的形状（`users/data.ts` 的注释自己写着："把条件做成入参而非可选的范围参数，
是为了让『有范围』在调用处显式可见——可选范围参数正是 fail-open 形状"）。

**删除测试**：删掉这个 seam，复杂度会回到哪里？只会回到 9 处**一行**的
`const scope = await resolveScope(db, userId)`。而 seam 的代价是真实的：
Next.js 16 Cache Components 要求 scope 在 `"use cache"` 作用域**外**解析后作为参数注入
（`users/data.ts:118-121`、`roles/data.ts:38-40` 都写着）。把"取快照 + 短路"包进一个
`readScoped(build)` 会把这条**约束**从调用点藏起来 —— 巡检自己也把它标为真实约束。

⇒ 按 `codebase-design` 的判据：**一个 adapter 是假 seam**。这里省下的是一行样板，
换走的是"缓存边界必须显式可见"这条信息。**不建。**

## 二、但候选指出的**失效模式**是真的，所以做这件事

读路径的失效模式是 **fail-open**（`roles/data.ts` 曾因此返回全部部门的角色）。
原语已经把"用错"变得很难：`scopeFilter` 空范围恒 `FALSE`、`UserScope` 用对象包裹以区分
"未取快照"与"范围为空"。**最后一公里仍靠人**——于是把"记得用"变成机械可查：

新守卫 `apps/portal/__tests__/api/read-scope-usage-guard.test.ts`，两条规则：

| 规则 | 抓什么 | 形态 |
|---|---|---|
| `resolve-scope-unused` | `const scope = await resolveScope(…)` 之后 `scope` 再未被引用 | 取了不用 |
| `scope-param-unused` | 形参注解为 `UserScope`、函数体却从未引用 | 收了不用（等价于可选范围参数那种 fail-open） |

扫描范围 `apps/portal/src` 全部生产 TS（≥40 文件的非空断言；用巡检候选 2 的共享脚手架）。

## 三、实测踩到的假阳性（已写成夹具）

规则最初按参数**名** `scope` 判定 ⇒ 全量扫描立刻误报 `lib/auth/token.ts` 的（`signAccessToken` 声明于 :84，参数 `scope?: string`）
`signAccessToken(…, scope: string)` —— 那是 **OAuth scope**（JWT claim），与 OBAC 数据范围无关。
⇒ 收紧为**必须注解 `UserScope`**，并把这条边界写成夹具 5（"OAuth scope 不是数据范围"）。
**这正是先跑全量、再收紧规则的价值**：规则写宽了会在真实代码上立刻暴露。

## 四、验证

| 项 | 结果 |
|---|---|
| 守卫自测 | **8 用例全绿**（7 夹具 + 1 条全量扫描），全量扫描在真实代码上**零违例** |
| `tsc` | 0 错 |
| **变异** | 抽掉 `roles/data.ts` 的 `conditions.push(scopeFilter(scope, schema.roles.deptId))` ⇒ 守卫**当红**并点名 `roles/data.ts:37 [scope-param-unused]` ⇒ 还原后 `git diff` 为空（逐字节） |
| 顺带修正 | `lib/authz/index.ts` 的 JSDoc 原写 `scopeFilter`"待读路径迁移时加入本模块"——**它早已在第 41 行导出**（过期文案，与本次会话反复出现的"声明 ≠ 实现"同形）⇒ 改为实况，并写明缓存边界约束与新守卫的兜底位置 |
| 阻断点 | `pre-commit` 的守卫名单**由扫描派生**（上一轮做的）⇒ 新守卫**自动**被收录，无需手抄 |

## 五、最佳实践（可复用）

1. **不是每个"重复"都值得抽 seam。** 判据是删除测试 + 代价：省一行样板却藏起一条架构约束，
   是负收益。写进决策索引，避免下次巡检重复提同一件事。
2. **原语难用错 ≠ 不可能用错。** 最后一公里（"记得调它"）应当由机械检查兜住，
   而不是靠 review 记忆——尤其当失效模式是 fail-open（静默返回全表）时。
3. **守卫的规则先跑全量，再收紧。** 假阳性会在真实代码上立刻现身（本次一次就抓到 OAuth scope），
   而夹具会把边界固定下来，避免下次又放宽。
