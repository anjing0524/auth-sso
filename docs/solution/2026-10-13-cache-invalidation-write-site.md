# 写后失效的「写入位置」维度 —— 一个入口分裂为两个（架构评审 R2 候选 R2）

> 日期：2026-10-13
> 来源：improve-codebase-architecture 架构评审第二轮（Strong 候选 R2，报告 `.arch-review/architecture-review-20261013-100205.html`）
> 关联 ADR：**ADR-019**（其「已完成的部分」表把本 module 记为收口完成，本次补记「写入位置」一维）、ADR-014（同一纪律：interface 允许了错误用法）
> 词汇：module / interface / seam / leverage / locality（codebase-design）

## 一、问题总结

`lib/cache-invalidation.ts` 是写后失效的唯一真相源，但它的 interface **只有一种形状**：
`invalidateResource(resource)` → 内部固定调 `updateTag`。

而 Next.js 对两个标签失效原语的可用位置有**硬性限制**：

| 原语 | Server Action | Route Handler | 语义 |
|---|---|---|---|
| `updateTag` | ✅ | ❌ **必抛 `E872`** | 立即过期，当前请求即可见新数据 |
| `revalidateTag` | ✅ | ✅ | 标记过期，按第二参决定陈旧窗口 |

守卫就在本仓依赖里（`node_modules/next/dist/server/web/spec-extension/revalidate.js:55-64`）：

```js
if (!workStore || workStore.page.endsWith('/route')) {
  throw ... 'updateTag can only be called from within a Server Action...use revalidateTag instead'  // E872
}
```

于是 **3 处 Route Handler 调用点的形态是**：`revalidatePath` 成功（该原语在 route 合法）→
`updateTag` 抛错 → 异常被 `withPermission` 的 catch 兜住 → **响应 5xx**。
而这三处的写事务**早已提交、不可回退**，客户端拿到 5xx 后重试会造成重复动作。

| 调用点 | 写事务 |
|---|---|
| `api/users/[id]/roles/route.ts:126`（POST） | `withScopedRow` 提交后 |
| `api/users/[id]/roles/route.ts:197`（DELETE） | 同上 |
| `api/users/[id]/force-logout/route.ts:79`（POST） | `revokeAllRefreshTokens` + `clearPermissionCache` 之后 |

### 为什么测试看不见它

`vitest.setup.ts:17-23` 把整个 `next/cache` 换成空实现：

```ts
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(),  // ← 永不抛
  cacheLife: vi.fn(), cacheTag: vi.fn(),
}));
```

`updateTag` 在这里是 `vi.fn()`，**抛错分支在测试里根本不存在**。而唯一会碰到它的
`force-logout-route.test.ts` 又把 `@/lib/cache-invalidation` 整体 mock 掉了。
这是「interface 就是测试面」被绕过后的典型盲区：**测试面比调用面窄**。

### 另外三条写路径整个绕过这张表

| 路径 | 问题 |
|---|---|
| `api/permissions/register/route.ts` | 写 `schema.permissions`（insert/update/软删）却**完全没引入失效模块**；`permissions/data.ts` 的档位是 `cacheLife('hours')` → 权限上报后列表最长陈旧**数小时** |
| `app/profile/actions.ts:73` | 调 `invalidateResource('profile')`，而该资源的 `tags` 是**空数组** → 改自己的 name/email/avatar **不刷新用户列表**（列表里正显示这些字段） |
| `api/auth/login/route.ts:87` | 写 `lastLoginAt`（用户列表的列）无失效。**经评估后有意不改**，理由见下 |

## 二、修复方案

### 决策：按写入位置给出**两个具名入口**，而不是加一个 `site` 参数

```ts
// Server Action 位置
export function invalidateResource(resource, extraPaths?): void          // 内部 updateTag
// Route Handler 位置
export function invalidateResourceFromRoute(resource, extraPaths?): void // 内部 revalidateTag(tag, { expire: 0 })
```

沿用本仓既有纪律（`docs/solution/2026-09-30-rt-revocation-module-consolidation.md`：
**维度用函数名编码，不用条件参数化**）——调用方 grep 函数名即知该用哪个，
不给「传错一个枚举值」的机会。两个入口共用同一张资源表与同一段路径装配。

**为什么不用 `updateTag` 的自动降级（try/catch 或探测）**：Next 没有公开的
"当前是否在 route 上下文"探测 API；try/catch 会让"该抛的错误"静默降级，
掩盖真正的误用。

### 为什么 route 版的第二参是 `{ expire: 0 }` 而不是官方推荐的 `'max'`

官方文档对 `'max'` 的定义是 stale-while-revalidate（**先服务陈旧内容**、后台再验证），
而 `{ expire: 0 }` 的说明正是本场景：「调用方需要数据**立即**失效、但**无法使用
`updateTag`** 时使用」。这三处失效服务于权限 / 会话 / 配置类写入——**陈旧内容本身
就是错的**。且单参形式已废弃并会打印警告，故必须显式传第二参。

### 三条绕过的处置

- `permissions/register`：事务提交后补 `invalidateResourceFromRoute('permissions')`，
  **且仅在有变更时失效**（`inserted + updated + deprecated > 0`）——该端点常在每次部署
  被调用，无变更时失效会白白打掉 `hours` 档缓存。
- `profile`：资源表的 `tags` 由 `[]` 改为 `['users-list']`。
- `login` 的 `lastLoginAt`：**有意不改**。失效 `users-list` 会在每次登录时打掉管理端
  列表缓存（缓存抖动），而 `users-list` 的档位是 `cacheLife('minutes')`，陈旧窗口本就
  以分钟为界。代价大于收益，故记录在此而非静默放过。

## 三、同类普查（本仓纪律）

普查全部失效调用点，逐个判定所在位置：

| 位置 | 处数 | 入口 | 文件分布 |
|---|---|---|---|
| Server Action | **21** | `invalidateResource` | clients 5 · users 6 · departments 3 · permissions 3 · roles 3 · profile 1 |
| Route Handler | **4** | `invalidateResourceFromRoute` | `users/[id]/roles` 2 · `users/[id]/force-logout` 1 · `permissions/register` 1（本次新增） |

**21 这个数字正是 ADR-019「已完成的部分」表里写的「1 个原语 + 21 处调用」**——
也就是说，那次收口的计数只覆盖了 Server Action 一侧，**route 那 3 处是漏掉的增补**，
而且它们的失败模式在单测里不可观测。这是"收口完成的计数"与"收口完成的事实"之间的
一次典型分叉：数字对得上，覆盖面没对上。

## 四、验证

### 红灯控制证据（旧代码 + 新测试）

只 stash 生产代码、保留新测试后运行：

```
× 没有任何 route.ts 使用 Server Action 专用入口        ← 守卫点出 3 处违规
× 确有 route 走 route 版入口（正向对照）              ← 旧代码 0 处
× 绝不调用 updateTag（该原语在 route 上下文必抛 E872）
× 用 revalidateTag 且传 { expire: 0 }
× 页面路由仍失效
× extraPaths 一并失效
× departments 同时失效 list 标签与跨资源标签
× profile 必须失效 users-list
× 未知资源抛出，两个入口一致
Tests  9 failed | 7 passed (16)
```

保持绿的 7 例正是该绿的：扫描器的 4 条夹具断言、`updateTag` 动作版（未受影响，
正向对照）、`至少扫到 route 文件`（守卫不空转）、`没有任何 route.ts 直接触碰 updateTag`
（三处都是经 module 调用，不是直接 import）。4 个文件的变异前后哈希逐字一致。

### 我自己造成的一次回归（如实记录）

改完后 `pnpm test` **红了 3 例**：`force-logout-route.test.ts` 的 mock 只列了
`invalidateResource`，而路由改用 `invalidateResourceFromRoute` 后，**未列出的导出
变成 `undefined`** → `TypeError`。这正是 `CODING_STANDARDS.md` §2 记录过的坑
（"工厂整体替换模块时，未列出的导出是 undefined"）。

修法不是"补一个键"，而是改成 `importOriginal()` + spread，让未列出的导出走真身，
并把这次教训写进注解理由。

### 门禁

| 门禁 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错误 |
| `eslint .` | 0 error；改动文件**零新增**告警（`permissions/register/route.ts` 的 complexity 29 已用 `eslint --stdin` 对 HEAD 版本证明为既有） |
| `pnpm test` | **82 文件 / 695 用例全绿**（修复前 80 / 677） |

## 五、最佳实践（可复用）

1. **框架的"位置限制"必须体现在自己的 interface 上。** `updateTag` 只在 Server Action 可用，
   是框架的硬约束；把它藏在一个位置无关的入口后面，等于让每个调用点在运行时发现。
   两个具名入口是**把框架的位置约束前移到函数名**。
2. **失败模式在测试替身里不可观测时，造静态检查。** `next/cache` 被全局 mock 后，
   "route 里调 updateTag"这一形态在单测里**永远不会红**——这正是 `CODING_STANDARDS` §7
   「只由 diff 就能判定的模式，去造检查」的适用场景。守卫必须带**正向对照**
   （"确有 route 走 route 版入口"），否则扫描器写错时它会空转通过。
3. **收口的计数要与覆盖面分别核对。** 「1 个原语 + 21 处调用」这个数字是对的，
   但 21 只覆盖了一半位置。记录收口时同时写清**范围**（"21 处 Server Action"），
   否则数字会在下一次审阅里假装覆盖面也完整了。
4. **写后失效的默认取向是"立即失效"，不是"最终一致"。** 权限 / 会话 / 配置类写入
   走 `{ expire: 0 }`；`'max'`（stale-while-revalidate）只适合内容类数据。
5. **幂等写端点的失效要判"是否真有变更"。** 权限上报在每个部署都跑，无变更时失效
   会把 `hours` 档缓存打掉——失效本身也有成本，要在 interface 层面有价值判断。
