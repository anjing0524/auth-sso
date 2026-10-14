# 根部门守卫：把 ADR-002 的承诺真正实现 —— 以及"可达性"必须先证明（架构评审 R2 次级候选）

> 日期：2026-10-14
> 来源：improve-codebase-architecture 架构评审第二轮（**Speculative** 次级候选「根部门守卫缺失」）
> 关联 ADR：**ADR-002**（删除部门级联与根部门保护——本次兑现其第 30 行的承诺）
> 词汇：module / interface / implementation / seam / leverage / locality

## 一、承诺与实现的落差

ADR-002 明确写着（第 30 行）：

> **删除部门级联删除角色**（`ON DELETE CASCADE`）。系统预置角色绑在根部门，**根部门不可删除**
> （`CANNOT_DELETE_ROOT` 错误码保护）。

实测：

```
$ grep -rn CANNOT_DELETE_ROOT apps/ packages/ --include="*.ts"
packages/contracts/src/errors.ts:75:  CANNOT_DELETE_ROOT: `${ERROR_PREFIX}_4005`,
```

⇒ **该错误码只在 contracts 定义过，全仓零引用**；`validateDepartmentDeletable` 只检查
"有无子部门 / 关联用户 / 关联角色"，**没有任何根部门判定** ⇒ ADR-002 的承诺从未实现。

## 二、可达性分析（本轮最重要的一步，也是"先证明再修"的示范）

报告把这条标为 **Speculative**。动手前我先问：**这个状态真的可达吗？**

删除部门只有一条路径（`deleteDepartmentAction`，无 REST DELETE），它先过 `withScopedRow`
数据范围守卫——**要删除根部门，操作者的生效角色必须绑在根部门上**（根之上没有任何部门，
只有绑在根上的角色，其子树才覆盖根）。而该 action 的 `roleCount` 统计的是
`roles.dept_id = 根` 的**全部**行（**不过滤 status**）。

⇒ **能删根的调用者，其自身角色就绑在根上 ⇒ `roleCount ≥ 1` ⇒ 本来就会被"存在关联角色"挡住。**

**变异 R 实测印证**（把根守卫停用后重跑）：

```
AssertionError: expected BusinessRuleViolationError: 该部门下存在关联用户，无法… { code: '…' }
  to match object { code: 'AUTH_SSO_4005' }
-   "code": "AUTH_SSO_4005",
+   "code": "AUTH_SSO_1005",
```

即：**没有守卫时，根部门依然被拒**——只是拒绝来自"关联用户/角色"的**通用**码，
而不是 ADR-002 承诺的专属码。

⇒ **结论：这不是一个可被利用的漏洞**（根部门在当前唯一路径上不可达删除）。
但它仍值得修，理由有三，且都不是"顺手"：

1. **承诺必须兑现**：ADR-002 是当前有效决策文档，读者会相信根部门有专属保护；
2. **不变量不能依赖巧合**：现在的保护来自"操作者恰好有根绑角色"这一**偶然**事实——
   只要有人给 `roleCount` 加上 `status = ACTIVE` 过滤（看起来是个合理的收紧），
   或将来新增第二条删除路径，根部门就会**变得可删**；
3. **专属码可用**：`CANNOT_DELETE_ROOT` 从"零引用"变成"真实可发出"，
   客户端不再只能靠解析中文文案区分拒绝原因。

> **这一节的存在本身就是纪律**：报告说"缺失守卫"，我差点直接按"可删根部门"去写 red 测试——
> 而真正的 red 是**码不匹配**。**在写测试前先证明缺陷可达**，否则会写出一个
> "因为夹具报错而红"的假证据（本轮第一次跑就是这样：`duplicate key` 而非行为差异）。

## 三、修复方案

### 1. `BusinessRuleViolationError` 支持**具体业务码**（默认仍是通用码）

```ts
export class BusinessRuleViolationError extends DomainError {
  constructor(rule: string, code: ErrorCode = COMMON_ERRORS.VALIDATION_ERROR) {
    super(code, rule);
  }
}
```

默认参数让**既有调用点零改动**，同时新规则可以携带专属码
（`ERROR_STATUS` 仍按类名映射 → 422，语义不变）。

### 2. 根部门检查放在**最前**

```ts
export function validateDepartmentDeletable(checks: {
  isRoot: boolean; hasChildren: boolean; userCount: number; roleCount: number;
}): void {
  if (checks.isRoot) {
    throw new BusinessRuleViolationError('根部门不可删除', DEPARTMENT_ERRORS.CANNOT_DELETE_ROOT);
  }
  ...
}
```

**优先级由语义决定**：根部门**恒不可删**，与"有没有子部门/用户/角色"无关——
所以它排在最前，报的是根部门专属码而不是某个依赖计数。

`isRoot` 的判据是 `parentId === null`，与仓库既有的"根部门"定义一致
（`scripts/seed-rbac.ts` 查根部门用的就是 `parentId IS NULL`）。

### 3. 调用方传 `isRoot`

`deleteDepartmentAction` 传 `isRoot: row.parentId === null`。删除合成参数后，
编译器**直接指出**唯一调用方（`tsc` 报 `Property 'isRoot' is missing`）。

## 四、验证

| 证据 | 结果 |
|---|---|
| **红（正确原因）** | 用变异 R 取得：无守卫时拒绝码是 `AUTH_SSO_1005`（通用）而非 `AUTH_SSO_4005`（专属）⇒ 判别点是**码**，不是"是否拒绝" |
| 红（错误原因，已修正） | 第一次跑红是因为**夹具重复播种根部门**（`duplicate key`）——与缺陷无关，已修夹具 |
| 领域直测 | 新增 `validateDepartmentDeletable` 的 3 条用例（此前**零直接测试**）：无依赖通过、**根部门恒拒绝且携带专属码（4 种依赖组合逐一验证优先级）**、三类依赖各自拒绝 |
| 还原哈希 | `department.ts` = `00cfbc776eebaab3…e1bb80` 逐字一致 |

### 门禁

| 门禁 | 结果 |
|---|---|
| `pnpm test` | **96 文件 / 786 用例全绿**（782 → +4） |
| `tsc --noEmit` | 0 错误 |
| `eslint`（改动文件） | 0 问题 |

## 五、顺带的更广发现（另记 issue）

查 `CANNOT_DELETE_ROOT` 时发现**同类码全都没被发射**：

| 码 | src 引用数 |
|---|---|
| `CANNOT_DELETE_ROOT` (4005) | 0 |
| `DEPARTMENT_HAS_CHILDREN` (4003) / `DEPARTMENT_HAS_USERS` (4004) | 0 |
| `CANNOT_DELETE_SELF` (3008) / `CANNOT_DISABLE_SELF` (3009) | 0 |
| `CANNOT_DELETE_SYSTEM_ROLE` (5003) / `CANNOT_MODIFY_SYSTEM_ROLE` (5004) | 0 |

实现一律抛 `VALIDATION_ERROR`（1005）⇒ **contracts 里这套"实体业务码"词汇事实上是死的**，
客户端只能解析中文文案区分拒绝原因。本轮只接通了根部门这一条（ADR-002 明确点名它），
其余需要一个独立决定（要改的是**已上网的错误码**）——已记为后续 issue。

## 六、最佳实践（可复用）

1. **写缺陷测试前先证明可达性。** "文档说该有守卫"不等于"该守卫缺失导致可被利用"。
   本轮如果不先问，就会把一个**不可达**的状态写成"根部门可被删除"的假漏洞，
   并得到一个因夹具报错而红的假证据。**Speculative 候选尤其要先做这一步。**
2. **保护不能依赖巧合。** 根部门当时之所以删不掉，靠的是"操作者恰好有根绑角色"
   这一与根部门无关的事实。**判据的成立条件要与它声称保护的东西对齐**，
   否则任何一次"合理的收紧"都会把它打掉。
3. **契约里定义了却从不发射的码，是死的词汇表。** 它们让文档看起来比实现更精确。
   要么接通（像本轮这样），要么从契约里删掉——**不要留着当装饰**。
4. **错误构造函数的可选码参数是安全的最小改动。** 默认值＝原行为，既有调用点零改动，
   而新规则能携带专属码；`ERROR_STATUS` 仍按类名映射，HTTP 语义不变。
5. **删除/收窄公共签名时，编译器替你找齐调用点。** 给 `validateDepartmentDeletable` 加必填
   `isRoot` 后，`tsc` 立刻指出唯一调用方（本会话第三次观察到同一价值：R16 / R18 / 本轮）。
