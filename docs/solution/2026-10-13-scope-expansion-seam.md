# 有效部门范围收成一个 seam —— 并修掉它藏着的第二级缺陷（架构评审 R2 候选 R9）

> 日期：2026-10-13
> 来源：improve-codebase-architecture 架构评审第二轮（Strong 候选 R9，报告 `.arch-review/architecture-review-20261013-100205.html`）
> 关联 ADR：**ADR-014**（数据范围授权门面，本次修订其"附带修复"节）、ADR-002（OBAC 数据范围）
> 词汇：module / interface / implementation / seam / leverage / locality（codebase-design）

## 一、问题总结（两件，第二件是本轮真正的收获）

### 1. 门面曾经"只关了一半"

ADR-014 步骤 4/5 拆掉了范围原语，但拆的是 **barrel**：
`lib/auth/index.ts` 不再导出 `getUserRoleDeptIds` / `canAccessDept`，而
**`lib/auth/data-scope.ts` 仍在导出它们**——"barrel 为真、模块为假"。
任何调用方 `import '@/lib/auth/data-scope'` 即可绕开门面，正是 ADR-014 要消灭的"两种形状"。

原契约测试 `authz-surface.test.ts` 没抓到，因为它**只断言 barrel**（`not.toHaveProperty`）。
这就是"关门面只关了一半"：关上的是门把手，墙还开着。

同时 `canAccessDept` 的**生产调用方为 0**（只在 `data-scope.test.ts` 里被调用）——
它是被测试养着的代码。其判据（`!target || 空集合 || !includes`）与 `isWithinScope` **逐字相同**，
而后者带 `UserScope` 形状（能区分"未取快照"与"范围为空"，ADR-014 的核心抽象）。

### 2. 子树谓词的第二级缺陷：非根角色的深度 ≥ 2 后代全部漏掉

`ancestors` 是**完整祖先链**（root 在前、`/` 分隔、不含自身）——由
`domain/department.ts` 的 `computeAncestorPrefix` 权威定义：
`ancestors ? \`${ancestors}/${deptId}\` : deptId`。

而原谓词只有三条分支（自身 / `ancestors = deptId` / `LIKE 'deptId/%'`）。对
`TECH` 角色的直接子部门 `FE`：其 `ancestors` 是 `ROOT/TECH` —— **既不等于 `TECH`，
也不以 `TECH/` 开头**。于是：

> **技术部管理员（角色在 TECH）看不见前端组（FE）与后端组（BE）的用户与角色。**

方向上是 fail-closed（少看见数据），**不构成越权**；但它是真实的功能缺陷，
且 `/api/departments` 仍会返回断裂的树（父不在结果里的孙部门变成顶层）。

#### 与 ADR-014 记录的那次是**同一疾病**

| | 第一次（ADR-014 已记录） | 第二次（本轮） |
|---|---|---|
| 漏掉谁 | 根部门的**一级**子部门 | **非根**角色的深度 ≥ 2 后代 |
| 为什么漏 | `ancestors = ROOT` 不匹配 `LIKE 'ROOT/%'` | `ancestors = ROOT/TECH` 不匹配 `= TECH` 也不匹配 `LIKE 'TECH/%'` |
| 为什么长期存活 | **被写进了测试期望** | **同样被写进了测试期望** |

第二次被固化的三处断言：

```
it('角色 deptId 为 TECH — 返回 TECH 部门自身')      → expect(new Set(result)).toEqual(new Set([TECH_DEPT_ID]))
it('多角色多部门 — 合并去重')                       → expect(new Set(result)).toEqual(new Set([TECH_DEPT_ID, MKT_DEPT_ID]))
it('与 DB 查询结果一致性验证')                      → // FE / BE / MKT 不在其管辖范围
```

用例名把"只返回自身"说成了**规范**，第三条更把 FE/BE 明写成"不在管辖范围"。

## 二、修复方案

### 1. 子树展开收进门面作私有 implementation

`expandRoleDeptSubtrees(executor, operatorId)` 移入 `lib/authz/data-scope.ts`，
**不导出**；`lib/auth/data-scope.ts` 删除；`canAccessDept` 删除（0 调用方 + 与
`isWithinScope` 判据重复）。

### 2. 谓词改为逐段判定（五条分支）

| 分支 | 命中 |
|---|---|
| `id = deptId` | 部门自身 |
| `ancestors = deptId` | deptId 在**链首**（其直接子部门，ROOT → `ROOT`） |
| `ancestors LIKE deptId/%` | deptId 在**链首**的更深后代（ROOT → `ROOT/TECH`） |
| `ancestors LIKE %/deptId` | deptId 在**链尾**（其直接子部门，TECH → `ROOT/TECH`） |
| `ancestors LIKE %/deptId/%` | deptId 在**链中**（孙子及更深，TECH → `ROOT/TECH/FE`） |

**方向性**：新增分支只**扩大**范围、不缩小，故对既有范围内的对象零影响——
这也解释了为什么全量测试除本文件外无一处变红。判据必须是 `/` 边界匹配，
UUID 不含 `%`/`_`，无 LIKE 通配符注入面。

### 3. 契约测试补上"模块级"这一半

`authz-surface.test.ts` 增补 `describe('范围原语的模块级封闭')`：
- `@/lib/authz/data-scope` 与 `@/lib/authz/query` 均不导出 `getUserRoleDeptIds` / `canAccessDept`，
  且连私有名 `expandRoleDeptSubtrees` 都不出现在导出面上；
- 用 **fs 断言**原模块 `src/lib/auth/data-scope.ts` 已不存在（不用 `import()`：那是构建期解析，
  失败形态不可控）。

## 三、同类普查

| 检查项 | 结论 |
|---|---|
| 全仓子树展开 | **只此一处**（`grep ancestors` 的其余命中是 `departments/data.ts` 的字段读取与 `departments/actions.ts` 写入时读父链，都不是范围判定） |
| `canAccessDept` 判据 | 与 `isWithinScope` **逐字相同**；且后者带 `UserScope` 形状 → 删除无覆盖损失 |
| `canAccessDept` 的 5 条纯边界测试 | 与 `authz-write.test.ts:92-101` 的 `isWithinScope` 边界用例**完全重复**（空范围 / null / undefined / 在范围内 / 不在范围内）→ 随函数一并删除，并在测试里写明"边界在哪覆盖"，避免读者以为漏了 |
| 其它 `ancestors` 谓词 | 无（全仓仅本函数构造 LIKE 谓词） |

## 四、验证

### 变异：去掉新增的两条分支（回到修复前的三分支谓词）

```
× **非根角色覆盖全部后代**：TECH 角色 → TECH + FE + BE
× 多角色多部门 — 合并去重
× 混合 ACTIVE + DISABLED 角色 — 只计有效角色
× 与 DB 查询结果一致（自家子树 true，兄弟/祖先部门 false）
→ Tests  4 failed | 5 passed (9)
```

**4 条变红全在"非根角色须见后代"这一类**；保持绿的 5 条是根级/叶子/无角色类——
恰好是旧谓词本来就能处理的那一半。这既证明修复承重，也证明它的作用域精确。
还原后哈希 `7a4cc62ac3e0479e…b7dec6` 逐字一致。

> 过程中的一次自省：还原脚本第一次断言失败，原因是我的守卫写成 `'链尾' not in 文件`，
> 而"链尾"这个词**也出现在函数文档表格里**。**守卫本身也会写错**——失败后先 `grep` 看清
> 文件真实状态（它当时就是变异后状态），再改守卫，而不是猜。

### 门禁

| 门禁 | 结果 |
|---|---|
| `pnpm test` | **86 文件 / 722 用例全绿**（725 → 722：删 5 条重复纯测试、增 2 条门面测试） |
| `tsc --noEmit` | 0 错误 |
| `eslint`（改动文件） | 0 问题 |

**关键证据**：除本文件外**全库无一处测试因范围扩大而变红**——说明没有别的测试把
这个缺陷固化，也说明修复不影响既有范围内的对象（只增不减）。

## 五、最佳实践（可复用）

1. **"关门面"必须关到模块，不能只关 barrel。** `export` 是每个模块各自的事实，
   `index.ts` 不再转发 ≠ 原模块不再导出。**契约测试要断言到模块一层**
   （`import('@/lib/authz/data-scope')` 上没有它），而不是只断言 barrel。
2. **把缺陷写进测试期望，比没有测试更危险。** 没有测试时，正确实现可能被写出来；
   缺陷成了期望之后，**正确实现会让测试变红**，于是 bug 被"保护"起来。
   判据：见到 `it('……— 返回 X 自身')` 这类把窄行为描述成规范的用例名时，
   回去问一遍"真的是这样吗"。
3. **物化路径的"在链上"判定必须逐段匹配。** 祖先链是 `a/b/c`，判 `X` 是否在链上
   需要覆盖链首/链尾/链中三种位置——只判链首（`= X` 与 `LIKE 'X/%'`）会漏掉
   "X 是链尾/链中"的全部情形，且**漏的深度随角色层级加深而增加**。
4. **先量化修复的方向性再动手。** 本例新增分支只扩大范围 ⇒ 可断言"既有范围内零影响"，
   因此"全量测试无一处变红"是**预期**而非侥幸；反过来若修复会缩小范围，全绿反而是红旗。
5. **删掉测试养着的代码时，要指出覆盖去了哪。** `canAccessDept` 的 5 条纯测试与
   `isWithinScope` 的边界用例重复——删除时在文件里写明"边界在 authz-write.test.ts 覆盖"，
   否则下一位读者会以为丢失了覆盖。
6. **守卫生效与否自己也要验。** 本轮还原脚本的守卫因"关键词也出现在文档里"而误判；
   **断言失败时先看清状态，再改守卫**——不要假设文件没被改过。
