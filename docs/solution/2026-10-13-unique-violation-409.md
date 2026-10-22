# 唯一约束冲突必须在服务端边界翻译成 409（架构评审 R2 候选 R10 · 第一半）

> 日期：2026-10-13
> 来源：improve-codebase-architecture 架构评审第二轮（Strong 候选 R10 的"唯一性兑现率 3/5"）
> 关联 ADR：ADR-019（Controller 职责约束）、`docs/portal-architecture-guidelines.md` §3.4（错误映射）
> 词汇：module / interface / seam / leverage / locality（codebase-design）

## 一、问题总结

五个实体的「唯一性冲突 → 409」兑现率只有 **3/5**：

| 实体 | 唯一约束 | 原行为 |
|---|---|---|
| `users` | `username` / `email` / **`mobile`** | **create** 事务内查重 → 409；**update** 与 **mobile** 无检查 |
| `roles` | `code` | 事务内查重 → 409 |
| `permissions` | `code` | 事务内查重 → 409 |
| `departments` | `code` | **直接 insert → 500** |
| `clients` | （见下） | —— |

### 缺陷链（`departments.code`）

```
tx.insert(departments) → PG 23505 → DrizzleQueryError
  → withAuth/mapServerError → unstable_rethrow → mapDomainError
  → 不是 DomainError → { status: 500, error: 'INTERNAL_ERROR', message: '服务器内部错误' }
```

用户看到「服务器内部错误」，而不是「部门 的 编码 已存在」。`/api/departments` POST 是真的 HTTP 500。

### 报告里有两处需要更正（已实测核对）

1. **`clients` 没有问题**：报告写"departments / clients 直接 insert"。实测
   `clients.clientId` 是**主键**且由 `generateClientId()` **生成**（非用户输入），
   `clients` 表没有其它唯一约束 ⇒ **没有用户可触发的重复**。本候选不动 clients。
2. **报告没提到的缺口更大**：`users.update`（改 username/email/mobile）与
   `users.mobile`（部分唯一索引 `ux_users_mobile`）同样无检查 ⇒ 也是 500。

### 为什么"先查后写"本身修不好它

先查后写**对并发不安全**：两个并发请求都能通过 `existing === null`，落库时后者仍撞约束，
仍然是 500。所以补预检查只能降低发生率，**不能消除**这一缺陷。

## 二、修复方案：把翻译放在**唯一**的服务端边界

`lib/server-error.ts` 的 `mapServerError()` 是所有 Server Action（`withAuth`）与
REST Route（`withPermission`）的**唯一**错误出口（实测 `mapDomainError` 只有一个
绕过点：`api/auth/logout/route.ts`，与用户可触发的唯一约束无关）。在那里先认
PostgreSQL 唯一约束违例，翻译成 `DuplicateEntityError` → **409**。

新增 `lib/db-errors.ts`：`uniqueViolation(error)` —— 沿 `cause` 链找 `code === '23505'`。

三条设计要点：

1. **必须走 `cause` 链**。Drizzle 抛的 `DrizzleQueryError` 自有键只有
   `query` / `params` / `cause`，**自身没有 `code`**；真正的 `PostgresError`
   （`code: '23505'`、`table_name`、`constraint_name`、`detail`）在 `cause` 上。
   "直接读顶层 `error.code`"永远拿不到 23505——**这正是缺陷被漏掉的机制**。
2. **只认一个 SQLSTATE**。`23502`（not-null）、`23503`（外键）同样是数据库错误，
   但语义不是冲突；把一切 DB 错误报成冲突会让真实故障被误诊。有专门用例钉住
   「not-null 违例仍映射为 500」。
3. **绝不回显冲突值**。PG 的 `detail` 形如
   `Key (email)=(someone@x.com) already exists.`——**带值**，且那是**库里已存在那位**的
   邮箱/手机号/用户名。只解析出列名（`/^Key \(([^)]*)\)=/`），值一律丢弃；
   消息由 `table_name` + 列名翻译成中文（未映射的回退为原始名）。

### 为什么不删/不加事务内预检查

- **不加**：边界已提供正确性与并发安全，预检查只是冗余（且它自己不安全）。
- **不删**：既有的三处预检查能"更早"给出消息，删除属无关重构（AGENTS.md：不动没坏的东西）——
  但在文档里写明它们已**退化为优化**，正确性不依赖它们。

## 三、同类普查（用户可触发的唯一约束）

| 表 | 约束 | 用户可触发 | 处理 |
|---|---|---|---|
| `users` | `username`、`ux_users_email`、`ux_users_mobile` | ✅ create + update | 边界统一 → 409 |
| `roles` | `code` | ✅ | 同上 |
| `permissions` | `code` | ✅ | 同上 |
| `departments` | `code` | ✅ | 同上 |
| `clients` | `clientId`（主键，**生成器**产生） | ❌ | 不需处理（已核实） |
| `authorization_codes` | `code` | ❌ | 系统生成（CSPRNG） |
| `refresh_tokens` | `token_hash` | ❌ | 系统生成 |
| `jwks` | `kid` | ❌ | 系统生成 |

**关键收益（leverage）**：新增任何用户可触发的唯一约束**无需**再写预检查——
边界自动给出 409 与可读消息。

## 四、验证

### 红 → 绿

实现前，8 条用例中 **7 条红**（6 条真实 PG 违例 + 1 条真实 `withPermission` 端到端），
唯一绿的是「not-null 仍 500」这条防过度映射的守卫。实现后 **8/8 绿**。

测试用**真实 PG 违例**（不是手写错误对象）喂**真实映射链**——因为手写
`{ code: '23505' }` **测不出**"必须走 cause 链"这一点。

> 过程中修正了自己的测试：最初 `users` 用例只种 `users` 而不种根部门，
> 于是先撞的是**外键违例（23503）而非唯一约束**——两者都映射 500，
> 会让"红"看起来对、原因却是错的。补上根部门后才得到**原因正确**的基线。
> **失败的测试也必须失败在正确的原因上。**

### 变异

把 `uniqueViolation` 改成**只读顶层 `code`、不走 `cause` 链**（即"朴素实现"）：
**11 条精确变红**——4 条单元（需要包装链的）+ 7 条真实 PG，
而「顶层就是 23505」「23502」「23503」「自引用」「超深链」「非对象」6 条保持绿。
还原后哈希 `5e0247018596007f…f908666` 逐字一致。

### 门禁

| 门禁 | 结果 |
|---|---|
| `pnpm test` | **88 文件 / 740 用例全绿**（+2 文件 +18 用例） |
| 既有用例影响 | **0 处**（`mapServerError` 是全局入口，改前专门跑全量确认） |
| `tsc --noEmit` | 0 错误 |
| `eslint`（改动文件） | 0 问题 |

## 五、最佳实践（可复用）

1. **"先查后写"永远不是唯一性保证。** 它只是提前给消息；**唯一权威是数据库约束**，
   把约束违例翻译成领域语义才是正确性与并发安全的落点。
2. **错误的形状可能被包装一层——先 dump 出来再写识别逻辑。** Drizzle 把 PG 错误包在
   `cause` 上，顶层没有 `code`。我最初的猜测（顶层读 `code`）就是缺陷存活的原因；
   **实测（打印 cause 链的每一层）比读文档可靠**。
3. **数据库错误里带着别人的数据。** PG `detail` 含冲突**值**，透传即泄露第三方
   邮箱/手机号/用户名。只取列名，并专门写一条"消息不含该值"的断言。
4. **认一类错误，不要认"凡是数据库错误"。** 23502/23503 也来自数据库，
   报成冲突会把真实故障误诊；为"不该被映射的那一类"专门写用例。
5. **失败的测试必须失败在正确的原因上。** 我第一版用例因缺外键父行而先撞 23503——
   同样 500、看起来也红，但证明不了任何关于唯一约束的事。**构造失败场景后要确认
   触发的是目标约束**（可打印 `detail` / `constraint_name` 核对）。
6. **测试要用真实错误对象喂真实链路。** 手写的 `{ code: '23505' }` 会让
   "必须走 cause 链"这条最关键的事实**测不出来**。
