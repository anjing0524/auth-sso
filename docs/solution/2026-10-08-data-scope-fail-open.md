# 数据范围 fail-open 与"已修复"声称的失效

> 日期：2026-10-08
> 来源：improve-codebase-architecture 架构评审候选 ② + 一手来源调研
> 关联 ADR：ADR-002（OBAC 数据范围）、ADR-005（三层安全模型）、**ADR-014**（数据范围授权收敛为单一门面）
> 词汇：module / interface / seam / depth / locality（codebase-design）

## 一、问题现象

`apps/portal/src/app/(dashboard)/roles/data.ts` 的角色列表读模型，部门范围过滤是**可选**参数：

```ts
// 修复前
function buildRoleConditions(keyword: string, status: string, deptIds?: string[]) {
  const conditions = [];
  if (deptIds && deptIds.length > 0) {      // ← 省略 deptIds 时整段跳过
    conditions.push(inArray(schema.roles.deptId, deptIds));
  }
  ...
  return conditions.length > 0 ? and(...conditions) : undefined;   // ← undefined = 无 WHERE
}

export interface RolesListParams {
  deptIds?: string[];                        // ← 可选
}
```

**后果**：任何调用 `getRoles({ page, pageSize, keyword, status })` 而不传 `deptIds` 的代码，会静默拿到**全部部门的角色**（含其他部门的角色名与编码）。

## 二、根因分析

### 5-Why

1. 为什么返回了全表？→ `deptIds` 未传时没有产生任何范围条件，`and()` 返回 `undefined`，`where(undefined)` 等价于不过滤。
2. 为什么能未传？→ 参数签名是 `deptIds?: string[]`，**可选**。
3. 为什么当时设为可选？→ 该函数有过"无需范围"的调用形态（Server Component 自查询），可选参数是为了兼容两种调用者。
4. 为什么这个兼容是致命的？→ 因为**"省略"与"传空数组"承载了完全不同的语义**：传空数组是"无权限"（已 fail-closed 早退），省略是"不限制"。但类型系统对二者都接受，且签名上的 `?` 让调用者读成"可选地进一步收窄"，而真实语义是"不传则不做任何限制"。
5. 为什么会漏过审阅？→ 同仓库已有正确的 fail-closed 实践（`db/user-queries.ts` 的 `sql\`FALSE\``），但它是**逐个函数手工施加**的，不是结构强制的。**同一安全规则存在两套写法时，正确性取决于每个函数各自的选择。**

### 归因

不是"忘了写过滤"，而是**interface 允许了错误的用法**。

内部证据：同一项目内 `users/data.ts` 用的是 `isScopeDenied(deptIds)` + `sql\`FALSE\``（fail-closed，且 `deptIds` 必填），`roles/data.ts` 用的是可选参数（fail-open）。**同一条 ADR-002 规则，两个 data.ts 给出相反的默认行为。**

## 三、纠正措施

1. `deptIds` 改为**必填**，并在注释中写明"刻意不设为可选"及其原因（防止后人"顺手"改回可选）。
2. 在 SQL 层保留兜底 `else conditions.push(sql\`FALSE\`)`——纵深防御，不依赖调用方的早退。
3. `getRoles` 的空范围早退由 `deptIds?.length === 0` 改为 `deptIds.length === 0`（原先可选链掩盖了 `undefined`）。
4. 新增读模型级回归测试 `__tests__/api/role-data-scope.test.ts`：空范围→空集、单部门范围→仅该部门、双部门范围→并集且不含范围外、关键字不得放大范围。

**验证**：`tsc --noEmit` 0 错误；`test:api` 25 文件 / 232 用例全绿（新增 4 例）。

## 四、最佳实践沉淀

### 1. 可选的范围参数 = fail-open，一律禁止

安全过滤参数**不得为可选**。"不加限制"必须写成显式的 `Unscoped` 命名或独立函数，不能在同一个签名里用 `?` 表达两种语义。

**判别信号**：`grep -n "deptIds?" **/data.ts` 有命中即为风险点。

### 2. 安全约束必须在 SQL 层始终存在，不能只靠调用方早退

```ts
// 对：约束在构造器内部，调用方无法绕过
if (deptIds.length > 0) {
  conditions.push(inArray(t.col, deptIds));
} else {
  conditions.push(sql`FALSE`);
}
```

**根因**：Drizzle 的 `and()` 在无有效条件时返回 `undefined`，而 `where(undefined)` **不报错、不过滤**。这让"条件为空"静默等价于"全表"。任何 `conditions.length > 0 ? and(...) : undefined` 的形状都是潜在 fail-open。

### 3. 新写的回归测试必须做变异验证

本次教训：第一版测试只覆盖"传空数组"，而缺陷入口是"不传参数"——**测试全绿但没锁住缺陷**。加入变异验证（临时移除守卫，确认测试变红）后才证明有效：

```
变异：移除 sql`FALSE` 兜底 + 移除空范围早退
结果：✓ 复现 —— getRoles({ deptIds: [] }) 返回 3 个角色（全表），测试第 1 条断言失败
```

**做法**：对安全/边界分支的测试，写完必须问一句"把修复去掉，这个测试会红吗？"不会红就说明测试打在别处。

### 4. "已修复"的声称必须指明覆盖了哪一侧

`docs/spec-alignment-audit-2026-06-25.md:21` 记录：

> | A3 | TOCTOU（deptId 读写不在同一事务） | ✅ 已修复 — 事务内重读 deptId |

**该声称只覆盖了一半。** 事务内重读的是 **target.deptId**（被操作对象），而真正的时间敏感输入是 **operator 的范围快照 `deptIds`**，它仍在事务外计算。于是"操作者被降权"这一半完全敞开——9 条写路径中 8 条中招。

**规范**：审计条目涉及成对概念（读取方/被读取方、操作者/目标、旧值/新值）时，必须逐侧声明覆盖情况，禁止用单侧修复声称闭环。**"部分修复"写成"已修复"比不修更危险**，因为它会让后续审计跳过该条目。

### 5. 两种形状并存 = 正确性靠运气

同一安全编排在项目内存在两种写法时（`requireDeptAccess(tx, ...)` 与手写 `getUserRoleDeptIds + canAccessDept`），实际结果是 **Action 侧 16/16 正确，REST 侧 8/13 错误**。这证明缺陷源于 interface 允许了错误用法，而非开发者纪律。

**收口方向见 ADR-014**：把范围快照的获取与使用绑定到同一执行器，并把 `requireDeptAccess` 从公开面撤下。

### 6. 测试期望可能把缺陷固化成规范（本次最值得记住的一条）

子树展开谓词只用 `LIKE 'deptId/%'`，漏掉**一级子部门**——它们的 `ancestors` 恰等于 `deptId`（无末尾 `/`），不匹配该 LIKE。而"直接子部门被排除"这件事**被写进了测试断言**：

```ts
// data-scope.test.ts（修复前）
it('角色 deptId 为根部门 — 子树正确展开', async () => {
  // 注意：直接子部门(ancestors=ROOT_ID，无末尾'/')不匹配 LIKE 'ROOT_ID/%'
  ...
  expect(new Set(result)).toEqual(
    new Set([ROOT_DEPT_ID, TECH_DEPT_ID, FE_DEPT_ID, BE_DEPT_ID]),   // ← 刻意排除 MKT
  );
  expect(result.length).toBe(4);
});
```

**后果**：任何"符合直觉"的修复都会让这个测试变红，于是缺陷被测试保护了下来。产物侧的可见症状是 `/api/departments` 对管理员返回断裂的树（中间层 TECH 缺失 → 其子部门 FE 被 `buildDepartmentTree` 当作顶层，与"总公司"并列）。

**判别信号**：测试注释里出现"注意：……不匹配……"、"由于……所以……被排除"这类**为异常行为辩护的解释**时，要停下来问："这是规范，还是我们正在固化一个 bug？"**规范的异常应当来自需求决策，不是实现的副作用。**

**处置**：这种用例不能只改断言，必须把注释改成记录缺陷历史（本次已改），否则下一个读者仍会以为"排除"是有意设计。

### 7. 并发跑同一个物理测试库会让测试互相破坏

`vitest.api.config.ts` 设了 `fileParallelism: false` + `maxWorkers: 1`，**单进程内**文件是串行的。但 `cleanup()` 是 `TRUNCATE … CASCADE` 打在同一物理库上——**两个 vitest 进程同时跑就会互相截断**，表现为 `departments_pkey` 唯一冲突、`users_dept_id_fkey` 外键失败等看似"夹具错误"的告警。

**教训**：这类失败与代码无关，却极易误判为回归。诊断顺序应是——先确认**只有一个** vitest 进程在跑（`pgrep -af vitest`），再看失败内容。本次即因此浪费了一轮排查。

## 五、同类问题审阅

| 位置 | 问题 | 状态 |
|---|---|---|
| `departments/data.ts` | JSDoc 声称"`deptIds` 可选：API Route 传入"，但参数根本不存在，查询无范围过滤 | ✅ 已修（ADR-014 步骤 3） |
| `departments/data.ts` | `getDepartmentMembers` 仅按 `departmentId` 过滤，作用域强制 100% 在调用方 | ✅ 已修 |
| `lib/auth/data-scope.ts` | 子树谓词漏掉一级子部门（`ancestors = deptId` 未匹配） | ✅ 已修（见最佳实践 6） |
| 3 条 TOCTOU 写路径 | operator 范围快照在事务外获取 | ✅ 已修（ADR-014 步骤 2） |
| 5 处只读守卫 + 3 个 `data.ts` 的 `deptIds: string[]` | 形状 B 与 `Scope` 未统一 | ⬜ 待修（ADR-014 步骤 3 剩余） |
