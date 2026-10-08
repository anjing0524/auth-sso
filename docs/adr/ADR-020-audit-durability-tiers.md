# ADR-020: 审计写入的持久性等级 —— 按「是否与业务同事务」分档，而非统一策略

| 属性       | 值                                                                    |
|------------|-----------------------------------------------------------------------|
| **状态**   | implemented (2026-10-08)                                              |
| **日期**   | 2026-10-08                                                            |
| **决策者** | Auth-SSO 团队（improve-codebase-architecture 架构评审候选 ⑧）          |
| **影响范围** | `lib/audit.ts`、`lib/auth/guard.ts`（调用点语义澄清）                  |

## 背景

`lib/audit.ts` 的文件头声明：

> 集中管理登录日志（login_logs）和操作审计日志（audit_logs）的写入。
> **采用 fire-and-forget 模式：直接写入 DB，不缓冲、不阻塞主流程。**

而实现里有**三档语义不同**的写入，其中两档与这句话矛盾：

| 档 | 函数 | 实现 | 与文件头声明的关系 |
|---|---|---|---|
| ① | `appendSecurityAudit(tx, …)` | `await tx.insert(...)`，**在业务事务内** | 直接矛盾：它**必须**阻塞，且失败要连同业务回滚 |
| ② | `recordActionAudit` / `recordApiAudit` | `await db.insert(...)`，业务提交**之后** | 部分矛盾：它 await，会阻塞主流程 |
| ③ | `writeLoginLog` / `writeAccessLog` | `fireAndForget` + 3 次重试 | 与声明一致 |

### 真实的缺陷：档②会把已成功的写操作报成失败

`lib/auth/guard.ts` 的 `withAuth`：

```ts
try {
  const res = await fn({ userId: check.userId }, ...args);
  if (res.success && options.audit) await recordActionAudit(check.userId, options.audit);
  return res;                                    // ← 业务事务此刻已提交
} catch (err: unknown) {
  const mapped = mapServerError(err);
  return { success: false, error: mapped.error, message: mapped.message };
}
```

`await recordActionAudit(...)` 在**内层 catch 之前**。若审计写入抛错（审计表不可用、连接中断），异常被内层 catch 捕获，**返回一个失败的 `ApiResponse`**——而此刻业务事务**早已提交**。

后果：调用方看到"失败"会重试，可能造成**重复写入**（如重复创建用户、重复分配角色）。`withPermission`（`guard.ts:69`）同理：审计抛错会让一个成功的 REST 响应变成 500。

**档②没有事务绑定，却有能力推翻业务结果**——这是本次要消除的核心问题。

## 决策

### 1. 按「是否与业务同事务」定义档位，而不是选一个统一策略

| 档 | 判定依据 | 失败语义 |
|---|---|---|
| **① 安全审计** `appendSecurityAudit` | 传入 `tx`，与业务写入同事务 | **必须抛出** → 业务一并回滚 |
| **② 控制面事件** `record*Audit` | 业务已提交之后的补记，无事务绑定 | **永不抛出** → 自身吞掉并记日志 |
| **③ 运维观测** `writeLoginLog` / `writeAccessLog` | 与业务无关的旁路 | 重试 3 次后放弃并记日志 |

判据是可判定的（"是否与业务同事务"），不需要为每个场景单独裁决。

### 2. 档②的"永不抛出"是 interface 的**显式保证**，由实现自身兑现

`recordActionAudit` / `recordApiAudit` 改为委托给一个内部函数，该函数 `try/catch`
包住全部逻辑（含 `headers()` 读取与 DB 写入），失败仅 `log.error`。

**为什么把保证放在函数内而非调用点**：调用点是 `withAuth` / `withPermission` 的共享
包装器，未来还会有新调用点。把 try/catch 留在每个调用点，等于让"不得推翻业务结果"
这条规则依赖每个作者记得包一层；放进函数内，它成为不可绕过的事实。

### 3. 档①与档②的失败语义刻意相反，并以此互相定义

`appendSecurityAudit` 的注释补明"**应当抛出**"：它的异常要传播到事务边界，让业务写入一并回滚。与档②的"永不抛出"看起来矛盾，实为同一条判据（是否同事务）在两个方向上的必然结果。**这个对照被测试直接锁住**。

### 4. 撤回文件头那句不成立的总括

删除"采用 fire-and-forget 模式"这一全局声明，改为在模块头以表格列出三档。**一个模块内存在多种失败语义时，不得用一句话概括全部**——那句概括正是本次误判的源头。

## 后果

**收益**
- 消除"审计补记失败 → 已提交的写操作被报成失败 → 调用方重试可能重复写入"这条路径。
- 三档语义成为 interface 的一部分，调用点不再需要理解实现细节。
- 新增 `audit-durability.test.ts`（5 例）锁住两档相反的失败语义，经**变异验证**（把档②退回上抛后，仅档②的 2 例变红，档①的例仍绿）。

**代价**
- `recordActionAudit` / `recordApiAudit` 不再抛出，调用方无法感知审计失败——这是刻意的：它们**没有资格**推翻业务结果。可观测性由 `log.error` 承担。

**已知未修（挂账）**
- **`x-action-method` / `x-action-path` 是永不被满足的契约**：这两个头在整个仓库中**没有任何注入点**（Portal 与 Gateway 均无）。因此档②写入的 `method` 恒为兜底值 `'ACTION'` / `'API'`，`url` 恒为 `null`。API 层已改用 `request.url` 记录真实 URL，但 `audit_logs.url` 仍为 null。修复方向是让审计记录从真实请求取 method/url（而非依赖不存在的头），属独立改动。

## 相关 ADR

- ADR-011: 故障语义分级（同一手法：按数据性质而非组件决定失败策略；本 ADR 把它应用到审计）
- ADR-018: 权限上下文故障分级（另一处"把语义压平导致误判"的修复）
- ADR-019: Controller 行数约束（同一纪律：规范不得声称与实现不符的事实）
