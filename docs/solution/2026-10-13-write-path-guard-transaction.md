# 写路径的守卫事务不得空转 —— 两处「零守卫」与一个形状守卫（架构评审 R2 候选 R11 · 第一半）

> 日期：2026-10-13
> 来源：improve-codebase-architecture 架构评审第二轮（Worth exploring 候选 R11）
> 关联 ADR：**ADR-014**（数据范围授权门面，本次修订 §2 的"第二级"）、ADR-019（Controller 职责约束）
> 词汇：module / interface / seam / leverage / locality（codebase-design）

## 一、问题总结

ADR-014 §2 的表格把两个写路径记为"已随 `withScopedWrite` 修复"。复核发现：
**形状修好了，不变量没有**——两处都把 handler 写成空函数：

```ts
await withScopedWrite(
  { operatorId, targets: async (tx) => { /* 事务内加载目标行 */ } },
  async () => undefined,          // ← 事务只做断言就提交
);
```

| 位置 | 事务里做了什么 | 随后 |
|---|---|---|
| `api/users/[id]/reset-password/route.ts` | 只有 `resolveScope` + 断言 | 用**事务外** `db` 读 `passwordHistory`，写入又是**另一个**事务 |
| `api/users/[id]/force-logout/route.ts` | 只有 `resolveScope` + 断言 | RT 撤销在**事务外** `db` 上执行 |

⇒ 「**快照与写入同事务**」（ADR-014 / H-ACL-002）仍被打破：操作者在断言之后、
真正写入之前被降权，越界写入照样成立。而代码看起来"有守卫"。

### 为什么长期没被发现

1. **行为测试看不出差别**：404 / 403 / 200 在正常路径下两种写法完全一样。
2. **两处都零测试覆盖**：`password-reset-session-revocation.test.ts` 覆盖的是
   `revokeAfterPasswordReset` 助手（Server Action 路径），**不是这个 REST 端点**。
3. `reset-password` 的文件头注释当时还**宣称**不变量成立——注释与实现相反。

### 附带发现：测试把契约也一并删掉了

`force-logout-route.test.ts` 同时 mock 了 `@/lib/auth` 与 `@/lib/authz`：

```ts
withPermission: (_o, h) => h(ADMIN_ID)        // 权限判定 + 错误映射双双消失
withScopedWrite: async (_o, write) => write(undefined)   // 守卫消失
```

于是测试里"领域错误以 **reject** 出现"，而生产契约是 `{success:false}` / 映射后的 HTTP 响应。
（同类的另一处：`user-actions.test.ts` 的 5 处 `rejects.toThrow(...)` 与 2 处
`success === false` **同时存在**，见 R11 第二半。）

## 二、修复方案

### 1. 两个路由改用 `withScopedRow`

它正是为"先加载目标行再动手"准备的：`load → 404 → 范围断言 → handler` 收在同一事务里。

- `reset-password`：加载目标行（含 `passwordHistory`/`passwordHash`）→ 复用校验（bcrypt 最多 5 次，
  **原先最长的敞口窗口**）→ 写入，全在同一事务；404 由 `EntityNotFoundError` 经真实映射链产出。
- `force-logout`：加载目标行 → `revokeAllRefreshTokens(tx, id)`，撤销与断言同一事务。

### 2. `revokeAllRefreshTokens` 的 executor 改为**显式必填首参**

原签名只收 `userId`，内部固定用事务外的 `db`。改为 `(executor, userId)` ——
与兄弟函数 `revokeUserRefreshTokens(executor, userId)` 同形：**连接归属由调用方决定**。

不用可选参数：那会退化成"传不传都行"的条件参数化，而这里的正确性**恰恰取决于**调用方选对了执行器。

### 3. 404 错误码统一到 `AUTH_SSO_1004`

`reset-password` 原先内联返回 `USER_ERRORS.USER_NOT_FOUND`（`AUTH_SSO_3001`）。
改用 `EntityNotFoundError` 后与 `force-logout` 一致；再统一另外两处仅存的偏差
（`users/[id]` GET、`users/[id]/roles` GET——**同一个文件内**本来就有两种 404 码），
与 `docs/spec/API.md`「资源不存在 → 404 → `AUTH_SSO_1004`」的记载对齐。
`AUTH_SSO_3001` 全库**无任何消费方**（无前端/测试读取），故无契约风险。

### 4. 静态守卫：守卫事务不得空转

新增 `__tests__/api/scoped-write-guard.test.ts`：扫描 `src/**/*.ts`，断言不存在
`withScopedWrite(` 后跟空 handler（`async () => undefined` / `async () => {}`）的调用点。

**守卫自身也验**（含三条反样）：能抓正样、不误伤"真在事务里干活"的 handler、
不误伤 `withScopedRow`，并且**注释里描述该形状不算缺陷**——第一版正是被自己写的
修复记录（注释里含那段代码）误判为违规。

## 三、同类普查

| 检查项 | 结论 |
|---|---|
| 全仓 `withScopedWrite` handler 是否为空函数 | **只此 2 处**（已修）；其余 2 处（`roles/route.ts` POST/DELETE）handler 真在事务内干活 |
| `withScopedRow` 调用点 | 9 处，均为"load → 断言 → 动作"的正确形状 |
| `revokeAllRefreshTokens` 调用点 | 生产**仅 1 处**（force-logout）⇒ 签名收明显式 executor 代价极小 |
| 404 错误码 | 4 处曾分两种码；已统一为 API.md 记载的 `AUTH_SSO_1004`（`AUTH_SSO_3001` 无消费方） |

## 四、验证

### 红 → 绿

`force-logout-route.test.ts` 的 5 条在改造后先变红（`No "withScopedRow" export is defined on
the "@/lib/authz" mock`）——**同一个 partial-mock 陷阱第四次出现**。处置不是给 mock 补一个
`withScopedRow`（假事务里无法 `load` 目标行），而是**删掉那两个 mock**：
只 mock `@/lib/auth/check-permission`，让**真实 `withPermission`（含错误映射）**与
**真实数据范围守卫**全程参与，再为操作者播一个覆盖目标的角色。⇒ 5/5 绿，
且这个文件**少了两个替身**、多了两条真实链路（ADR-022 方向）。

新增 `reset-password-scope.test.ts`（5 例，该端点此前**零覆盖**）：
范围内 200 且密码/历史更新；**越界 403 且密码一个字节都没被写**；目标不存在 404；
复用最近密码 400 且不写；密码不合规 400 且不写。

### 门禁

| 门禁 | 结果 |
|---|---|
| `pnpm test` | **90 文件 / 747 用例全绿**（88/740 → +2 文件 +7 用例） |
| `tsc --noEmit` | 0 错误 |
| `eslint`（改动文件） | 0 error；2 条 warning 为**既有**（已用 `eslint --stdin` 对 HEAD 版本证明） |

## 五、最佳实践（可复用）

1. **"加了守卫"不等于"守卫生效"。** `withScopedWrite(..., async () => undefined)` 在代码
   审阅里极难看出问题（它看起来就是加了守卫），行为测试也看不出。**判据：handler 里有没有
   真正的写入**——没有就说明写入在别的事务里。
2. **为这种"写对了但没生效"的缺陷建静态守卫。** 它的特征是一个**形状**，不是一个行为；
   静态检查比行为测试更早、更稳地挡住回归（与 `authz-surface.test.ts` 同类）。
3. **守卫也要自测，包括反样。** 第一版守卫被"修复记录里的注释"误判为违规——
   **扫描代码前先去掉注释**，并把"注释不算缺陷"写成一个反样用例。
   （与 R9 的教训同源：**守卫自身也会写错**。）
4. **连接归属要显式。** 内部固定用 `db` 的写函数，一旦被事务内调用方使用就会静默破坏原子性；
   把 executor 提为**必填首参**，让"选对执行器"成为调用方显式决定的事。
5. **partial mock 会删掉整条链路，不只是删掉一个函数。** 整体替换 `@/lib/auth` 同时删掉了
   权限判定**与错误映射**，于是测试固化了与生产相反的契约。**只 mock 最窄的那个输入**
   （本例：`checkPermission` 的结果），其余走真身。
6. **记录"已修"时要说清修的是形状还是不变量。** ADR-014 §2 记"已随 `withScopedWrite` 修复"，
   而修好的是形状——不变量在 handler 为空时并不成立。**这一轮的教训是上一轮记录的颗粒度不够。**
