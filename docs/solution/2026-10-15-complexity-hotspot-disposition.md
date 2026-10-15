# 复杂度热点逐处处置：能修的小步修好，修不了的写明理由（ADR-019 收口）

> 日期：2026-10-15
> 来源：ADR-019「被新门槛标出的 5 处生产热点（**保留为待修，不静默豁免**）」——表格数字已过期，且部分热点从未被处置
> 关联：ADR-019（复杂度/长度约束）、`docs/solution/2026-10-14-cognitive-complexity-decision.md`
> 词汇：module / interface / seam / leverage / locality

## 一、为什么要收口

ADR-019 在 2026-10-08 列了 5 处热点并写明"**保留为待修**"。实测（2026-10-15）：

- 表里的**数字过期**（`performRevocation` 当时写 23，现 21；`register/route.ts` 当时写 56 行、现 59）；
- 实际告警是 **8 处**（表里 5 + `scripts/migrate.ts` / `vitest.globalSetup.ts` / `seedTestData`）；
- "待修"没有截止条件 ⇒ 它会**永久挂着**（这正是 ADR-019 自己对"待评估"的批评）。

⇒ 本轮逐处处置：**要么小步修好（带测试），要么写明接受的依据与触发条件**——两者都必须写下来，
不留"静默豁免"。

## 二、修好的 4 处（附证据）

| 位置 | 当时 | 处置 |
|---|---|---|
| `api/permissions/register/route.ts` | complexity **29** | 抽 3 个纯函数进 `domain/permission/permission-sync.ts`：`permissionRowChanged` / `toPermissionInsertRow` / `toPermissionUpdateRow`。路由回调变成线性编排（29 → <15，告警消失） |
| `app/(dashboard)/layout.tsx` `DashboardContent` | complexity **16** | 抽纯映射 `toDashboardUser`（`src/lib/dashboard-user.ts`）。告警的来源其实是 **JSX 属性里的五个 `??`**——归一化规则现在只有一处且有直测 |
| `lib/auth/token/signing-keys.ts` | 嵌套 **5** | 抽 `reuseConcurrentlyCreatedKey` —— "复用并发写入的密钥"这段双重检查终于有了名字 |
| `scripts/migrate.ts` | 嵌套 **5** | 抽 `applyStatementWithIdempotentSkip`（幂等错误跳过 + 失败带上文件名） |
| `vitest.globalSetup.ts` | complexity **16**、嵌套 **5–6** | 抽 `applyDrizzleMigrations` + `applyStatementIgnoringIdempotentErrors`（两级抽取才降到 ≤4） |

### 抽取时**编译器当场抓到一处真实缺陷**

把插入行整形搬进 `toPermissionInsertRow` 时，我漏了 `code` 列 —— **tsc 立刻报**
`Property 'code' is missing`（该列是插入必填）。同理，把 `status` 写成 `string` 时 tsc 也拦下了
（DB 枚举是联合类型，宽类型不可赋值）。**这就是"抽取必须让编译器/测试去核"的价值**：
如果只是"看起来搬对了"，这条缺陷会以"权限项丢了 code"的形式上线。

### 顺带补上的直测（一处真实缺口）

`permission-sync.ts` 原有 3 个纯函数（`flattenPermissions` / `getHashCode` / `findDuplicateCode`）
**完全没有直测** —— 只被"整条 register 路由能跑通"间接覆盖。
本轮新增 `__tests__/domain/permission-sync.test.ts`（**10 条**），覆盖新旧函数，
含关键一条：`toPermissionUpdateRow` 在 `parentChanged=false` 时**不写 `parentId`**
（用 `'parentId' in row === false` 断言）——避免无谓写。

> 顺带修掉我自己写的一处：第一版写成 `...(changed ? { parentId } : {})`（**恒等于空展开**），
> 会让"仅在变更时写"静默失效。改成**可选字段 + 显式赋值**，让类型本身表达该约束。

## 三、接受（不修）的 2 处 —— 附依据与触发条件

| 位置 | 现状 | 依据 | 触发条件 |
|---|---|---|---|
| `api/auth/logout/route.ts` `performRevocation`（complexity 21 + 嵌套 5） | 保留 | 复杂度来自 **5 段各自独立的 `try/catch`**：每步失败不影响其余，是**刻意的优雅降级**。拆成 5 个只此一用的函数只增加间接层，不增加清晰度 | 新增第 6 段撤销步骤、或出现"某步失败影响其余"的事故时重评 |
| `__tests__/helpers/test-db.ts` `seedTestData`（complexity 24） | 保留 | 11 行是**声明式**的插入顺序（子表在后）。表驱动需要 `db.insert(table as never).values(rows as never)` 这类强转，**牺牲类型安全**换 0 清晰度 | 插入表数超过约 15、或出现插入顺序错误的事故时重评 |

> 这与 ADR-019 对认知复杂度的结论一致：**指标会把"刻意为之的结构"算作复杂**。
> 区别在于：接受必须**写下理由与触发条件**，而不是让告警在输出里沉默地躺着。

## 四、验证

| 项 | 结果 |
|---|---|
| `pnpm test` | **103 文件 / 852 用例全绿**（+2 文件 13 用例：`dashboard-user` 3 + `permission-sync` 10） |
| `eslint`（4 处已修文件） | 复杂度 / 深度告警 **全部消失**（剩余 `no-console` 等为脚本固有） |
| `pnpm db:migrate` | 需要 `DATABASE_URL`（本机无 `.env.local` ⇒ 直接跑报"未设置"，**非本次改动**）；带上测试库 URL 后 **exit 0**，日志可见抽取后的「skip idempotent error」在跑 |
| register 端点相关测试 | `permission-api` / `resolve-active-client` / `cache-invalidation-site-guard` **30/30** |
| `vitest.globalSetup.ts` | 被**全部** API 测试覆盖（103 文件全绿即其验证） |

## 五、最佳实践（可复用）

1. **复杂度告警要"逐处处置"，不接受第三种状态。** 每个热点最终只有两个归宿：**修好**，
   或**写明依据与触发条件后接受**。"待修"挂着不动，等于把决定推迟给一个不存在的人。
2. **抽取必须让编译器与测试来核。** 本轮两次靠 tsc 抓到真实缺陷（漏 `code` 列、`status` 类型过宽）——
   手工搬运代码时，"看起来对"是最不可靠的判据。
3. **抽取的同时补直测。** 把不可测的代码搬个位置不叫重构；搬完之后它必须**能被单独钉住**
   （否则只是把复杂度换了个文件）。
4. **指标会把刻意为之的结构算作复杂。** 5 段独立 try/catch、11 行声明式插入都是这种情形；
   **接受它们不是妥协，而是承认指标的分辨率**——但必须写明理由。
5. **表格里的数字会过期。** ADR 表格既写"当时值"也写"现状"，并在复核时更新——
   否则读者会以为同一个热点仍是当年的样子。
