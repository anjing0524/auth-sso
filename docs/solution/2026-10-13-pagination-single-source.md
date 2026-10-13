# 分页判据收成一处 —— 并修掉它掩盖的两个真实缺陷（架构评审 R2 次级候选 · 分页三套并存）

> 日期：2026-10-13
> 来源：improve-codebase-architecture 架构评审第二轮（次级候选「分页原语三套并存，且语义互不相同」）
> 关联 ADR：ADR-019（Controller 职责约束）、`docs/portal-architecture-guidelines.md`
> 词汇：module / interface / implementation / seam / leverage / locality

## 一、问题总结

同一个「分页参数怎么钳制」的问题，仓库里有**三套判据**：

| 位置 | 判据 | 问题 |
|---|---|---|
| `lib/pagination.ts` `parsePagination` | `Math.max(1, parseInt(x) \|\| 1)`；pageSize 夹到 `MAX_PAGE_SIZE` | **正确**，但只接受 `URLSearchParams`，页面层用不上；模块**零测试** |
| `roles/page.tsx:22`、`users/page.tsx:28` | **裸** `parseInt(params.page \|\| '1', 10)` | 无钳制 |
| `src/app/audit/data.ts` | 自带 `clamp(val, min, max)`；pageSize 上限**硬编码 100** | 第三套实现，上限与 contracts 的 `MAX_PAGE_SIZE` 脱钩 |

### 缺陷 A：手改 URL 得到 **500**（真实、用户可触发）

数据层把页码直接换算成 `.offset((page - 1) * pageSize)`：

| URL | page | offset | 结果 |
|---|---|---|---|
| `?page=0` | 0 | `-20` | PostgreSQL `OFFSET must not be negative` → **500** |
| `?page=abc` | `NaN` | `NaN` | 非法 OFFSET → 500 |
| `?page=-5` | -5 | `-120` | 同上 |

实测（红测试原样输出）：

```
Caused by: PostgresError: OFFSET must not be negative
  parameters: [ '00000000-0000-4000-8000-000000000001', '2', '-2' ]
```

**管理员在地址栏按一下退格（`page=1` → `page=0`）就得到 500。**

### 缺陷 B：审计 CSV 导出的三列**恒为空**

`api/audit/export/route.ts` 把行强制转换为 `Record<string, unknown>` 后取字段：

```ts
logs.data.map((l: Record<string, unknown>) =>
  [l.createdAt, l.operator || l.username, l.operation, l.resource, l.detail, l.ip] …)
```

而 `getAuditLogs` 的真实行形状是
`{ id, userId, username, operation, method, url, params, ip, userAgent, status, duration, errorMsg, createdAt }`
——**`operator` / `resource` / `detail` 三个字段都不存在**。那层强制转换让 TypeScript 无法发现，
于是「操作人/目标资源/详情」三列在导出文件里是空值。该路由此前**零测试**。

### 报告里两处不准确（已实测）

1. "**5 个** `page.tsx` 手写 `parseInt`" —— 实际 **3** 处，其中 `clients/new/page.tsx:134` 是
   TTL 输入框（与分页无关），分页相关的是 **2** 处裸解析 + 1 处手写 `Math.max` 副本。
2. `audit/data.ts` 的路径写作 `(dashboard)/audit/data.ts` —— 实际在 **`src/app/audit/data.ts`**。

## 二、修复方案

### 1. 单点判据（`lib/pagination.ts`）

```ts
function normalizePositiveInt(value, fallback)   // 私有：三处共用的唯一判据
export function clampPage(raw, fallback = 1)
export function clampPageSize(raw, fallback = 20)   // 上限取 contracts 的 MAX_PAGE_SIZE
export function offsetFor(page, pageSize)           // 恒为非负整数
export function normalizePagination(page, pageSize) // 读模型入口：一次钳制三处共用
```

- `parsePagination` 改为调用 `clampPage` / `clampPageSize`（**行为不变**，8 个 route 零影响）。
- `offsetFor` 是「非法页码不得到达 SQL」的**最后一道结构保证**：即使某个调用方忘了先归一，
  `.offset(offsetFor(...))` 也不会产生负值或 NaN。

### 2. 页面层与读模型入口都用它

- `roles/page.tsx` / `users/page.tsx` / `audit-logs/page.tsx` → `clampPage(params.page)`（消灭 3 处手写副本）。
- 5 个读模型（`roles` / `users` / `permissions` / `clients`×2）→ `.offset(offsetFor(page, pageSize))`
  **且**入口 `normalizePagination(params.page, params.pageSize)`。

> 为什么两处都要：只用 `offsetFor` 时 SQL 安全了，但 `withPagination` 返回的
> `pagination.page` 仍是原始入参 —— `?page=0` 会显示「第 0 页」（不再 500，但仍是错的）。
> **归一放在入口，`LIMIT` / `OFFSET` / 元信息三者才必然一致。**

### 3. `audit/data.ts` 复用共享原语

删掉本地第三套 `clamp`；pageSize 上限改由 contracts 派生（不再硬编码 100）；
两次查询由**串行**改为 `Promise.all`（与 `withPagination` 同语义，省一个往返）。

### 4. CSV 导出：去掉强制转换，让字段名受真实行类型检查

删除 `(l: Record<string, unknown>)`，把三列映射到真实字段：
操作人 ← `username`、目标资源 ← `url`、详情 ← `params`（表头不改，SIEM 消费方零影响）。

## 三、同类普查

| 检查项 | 结论 |
|---|---|
| `.offset(` 站点 | **6** 处：5 处裸公式（已改 `offsetFor`）+ 1 处 `audit`（预算，已归一） |
| 手写页码解析 | **3** 处（3 个 page.tsx，已全部改 `clampPage`）；`grep parseInt(params.page` 归零 |
| 第三套 clamp | 1 处（`audit/data.ts`，已删） |
| 分页模块测试 | 0 → **8**（`pagination-offset.test.ts`） |
| 导出路由测试 | 0 → **2**（`audit-export.test.ts`） |

## 四、验证

### 红 → 绿（缺陷 A）

实现前 3 条集成用例红，错误正是生产故障：`PostgresError: OFFSET must not be negative`（`offset = '-2'`）。实现后 8/8 绿。

**变异 I**（把 `roles/data.ts` 的归一**与** `offsetFor` 同时退回）→ **3 条红，且错误原样复现 `OFFSET must not be negative`** —— 最强的变异证据：它复现的正是生产故障形态，而不只是断言不符。
还原后哈希 `2c0bb8d5dfe97965…8a7dd8` 逐字一致。

### 红 → 绿（缺陷 B）

**变异 J**（把导出路由退回 `l.operator || l.username` / `l.resource` / `l.detail` + 强制转换）→
`expected '' to be '/api/users/abc'`（目标资源列恒空）**精确复现**；`type=login` 那条保持绿（该路径本来就对）。
还原后哈希 `524ad72d9bc88ebf…14d5bb` 逐字一致。

### 门禁

| 门禁 | 结果 |
|---|---|
| `pnpm test` | **92 文件 / 758 用例全绿**（91/756 → +1 文件 +2 用例；另有 8 条分页用例） |
| `tsc --noEmit` | 0 错误 |
| `eslint`（改动文件） | 0 error；1 条 warning 为**既有**（`audit-logs/page.tsx` 的 `max-lines-per-function`，已用 `eslint --stdin` 对 HEAD 版本证明） |

## 五、最佳实践（可复用）

1. **"三套判据"不是风格问题，是缺陷温床。** 三套 clamp 里的两套各漏一半：页面层漏钳制（→500），
   audit 那套钳制对了但上限写死（→与 contracts 脱钩）。**同一语义出现第二个实现时，就该收成一个 module。**
2. **安全原语存在 ≠ 被使用。** `parsePagination` 一直是对的，但它只接受 `URLSearchParams`，
   页面层的 `searchParams` 是普通对象 —— 接口不匹配使正确实现"用不上"，于是各处手写。
   **修法是把原语做成两种输入都能用（`clampPage` 收单值），而不是要求调用方适配。**
3. **在 SQL 边界留一道结构保证。** `offsetFor` 即使被误用也不会产生负 OFFSET；
   **"最后一道"防线的价值在于它不依赖调用方是否记得先校验。**
4. **类型转换是缺陷的隐身衣。** `(l: Record<string, unknown>)` 让三个不存在的字段通过编译，
   导出的 CSV 安静地空了三列。**去掉转换后编译器立刻报错** —— 这就是"让纪律变成结构"。
5. **写测试时先确认夹具真的插入了数据。** 本轮的导出测试初版用 `seedTestData({ auditLogs })`，
   而 `SeedData` 不含日志表 → 静默忽略 → CSV 只有表头，断言报的是 `undefined.split` 而非缺陷本身。
   **夹具静默失败会把"红"变成噪声**（与 R10 的"失败必须失败在正确原因上"同源）。
