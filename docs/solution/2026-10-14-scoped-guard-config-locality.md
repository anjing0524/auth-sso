# 实体范围守卫配置集中一处 —— 以及「抽象已存在，调用点却没采用」（#71 结构那一半）

> 日期：2026-10-14
> 来源：**#71**（R11 的结构那一半）；与 **#69**（行映射零测试）同源
> 关联 ADR：**ADR-014**（写路径门面 / 快照与写入同事务）、**H-ACL-002**
> 词汇：module / interface / seam / leverage / locality

## 一、问题：安全配置在每个调用点各写一遍

每个实体的守卫配置（`load` / `deptOf` / `message` / `notFound`）在调用点逐字重复：

| 文件 | 重复处数 |
|---|---|
| `roles/actions.ts` | 2（更新 / 删除，仅更新那处多一个 `extraTargets`） |
| `departments/actions.ts` | 2（同上） |
| `users/actions.ts` | **1 处内联 + 1 处工厂**（见第二节） |

**为什么这不是"行数问题"**：`users/actions.ts` 自己的注释已经把这个失败的形态命名过——

> 这份守卫配置（授权到 `deptId`、越界消息、404 语义）原先在本文件里逐字重复 3 处。
> **安全配置散落时，改一处而漏改另一处就是越权**——收成一处才能保证「改则全改」。

⇒ 同样的道理适用于 roles / departments，只是这两处当时没做。

## 二、本轮的真发现：抽象已经存在，调用点却没采用

`users/actions.ts` 有 `loadUserScoped`，且它的文档写着：

> `selectColumns` 供只需要密码字段的场景收窄列（其余场景默认全列）。

而 `resetPasswordAction`（`:300`）**恰恰就是那个场景**，却把整份配置**内联**了一遍：

```ts
await withScopedRow(
  {
    operatorId: ctx.userId,
    load: (tx) => tx.query.users.findFirst({
      where: eq(schema.users.id, v.data.id),
      columns: { id: true, deptId: true, passwordHash: true, passwordHistory: true },  // ← 正是 selectColumns 的用途
    }),
    deptOf: (row) => row.deptId,
    message: '无权操作该部门的用户',
    notFound: () => new EntityNotFoundError('User', v.data.id),
  }, …
```

⇒ 改成 `loadUserScoped(ctx.userId, v.data.id, { id: true, deptId: true, passwordHash: true, passwordHistory: true })`。
**这是"抽象已存在但没被采用"这一类比"没有抽象"更隐蔽**：文档声称覆盖了该场景，
所以读文档的人会以为已经在用；只有**数一遍文案出现次数**才会发现。

## 三、修法：每实体一个守卫工厂（形状与既有先例一致）

```ts
function loadRoleScoped(
  operatorId: string,
  roleId: string,
  extraTargets?: () => Array<{ deptId: string; message: string }>,
) {
  return {
    operatorId,
    load: (tx: DbTxHandle) => tx.query.roles.findFirst({ where: eq(schema.roles.id, roleId) }),
    deptOf: (row: { deptId: string | null }) => row.deptId,
    message: '无权操作该部门的角色',
    ...(extraTargets ? { extraTargets } : {}),
    notFound: () => new EntityNotFoundError('Role', roleId),
  };
}
```

- **形状照抄 `loadUserScoped`**（同一纪律不另立新词）：返回守卫选项对象、`extraTargets` 以 thunk 传入
  （它依赖已校验输入，且必须与主目标共享**同一份范围快照**）。
- `departments` 同样得到 `loadDepartmentScoped`。
- **不改行为**：这是纯重构，两个文件的 21 + 42 条既有测试全绿。

### 为什么**不**做完整的 `scopedAction` 组合器（对 #71 建议方向的一处保留）

#71 建议再加一个 `scopedAction` 把 `withAuth + validate + withScopedRow` 也合成一个入口。
本轮**不做**，理由是它不关闭任何剩余风险：

1. **顺序已经被钉住**：`withScopedWrite` 不得空转由 `scoped-write-guard.test.ts` 静态守卫
   （R11 建立），`withAuth` 的审计发生在业务提交之后由 `guard.ts:40` 的结构保证。
2. **两个包装器都是具名 module**：调用点写的是 `withAuth(...)` + `withScopedRow(...)`，
   而不是裸序列；"仪式"本身已经是有名字的。
3. 再包一层需要把 `args` 透传、行类型、守卫选项全部泛型化——**为不存在的风险增加间接层**
   （Simplicity First）。**真正重复的是实体专属配置，那才是本轮去掉的东西。**

## 四、验证

### 静态守卫（钉住这个形状，防回归）

`authz-surface.test.ts`（"模块级封闭"同一族）新增：

```
app/(dashboard)/users/actions.ts      ：守卫文案在代码中只出现一次（改则全改）
app/(dashboard)/roles/actions.ts      ：同上
app/(dashboard)/departments/actions.ts：同上
```

两点纪律：
- **先去注释再计数**：注释里提到该文案不算缺陷（否则修复记录本身会让守卫变红——R11 的教训）；
- **证明它会失败**：变异 T（把 roles 的配置复制回调用点）→ **精确变红**
  `expected 2 to be 1`；还原后 10/10 通过。

### 门禁

| 门禁 | 结果 |
|---|---|
| `pnpm test` | **96 文件 / 789 用例全绿**（786 → +3 静态守卫） |
| `tsc --noEmit` | 0 错误 |
| `eslint`（改动文件） | 0 问题 |
| 重构前后行为 | 相关 42 + 21 条测试全绿（纯重构） |

## 五、最佳实践（可复用）

1. **"抽象已存在但调用点没采用"要专门查。** 文档声称覆盖某场景，不等于调用点在用它。
   最可靠的检查是**数一遍那个字面量/文案在代码里出现几次**——文档不会告诉你。
2. **安全配置的重复是"改则全改"问题，不是行数问题。** 判断该不该抽的标准不是"重复了几行"，
   而是**"漏改一处会不会变成越权"**。`loadUserScoped` 的注释已经写明了这一点，本轮只是把它
   推广到剩余两个实体。
3. **抽公共形状时照抄同仓既有写法，不要另立新词。** 本轮工厂与 `loadUserScoped` 逐项对齐
   （返回选项对象、thunk 化的 `extraTargets`），后来者读一个就懂另一个。
4. **静态守卫要先去注释再判定。** 否则"修复记录里的反例注释"会让守卫变红（R11 教训），
   于是人们开始绕过守卫。
5. **对建议方向要给出保留理由，而不是默默不做。** 本轮明确记录"为什么不做 `scopedAction` 组合器"
   （顺序已被静态守卫钉住 + 会引入无收益的泛型间接层），这样后续评审能基于理由反驳，而不是猜测。
