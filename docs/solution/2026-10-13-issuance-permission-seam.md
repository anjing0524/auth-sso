# 签发路径的权限分级收成一个 seam —— 判定一处、投递各自（架构评审 R2 候选 R6）

> 日期：2026-10-13
> 来源：improve-codebase-architecture 架构评审第二轮（Strong 候选 R6，报告 `.arch-review/architecture-review-20261013-100205.html`）
> 关联 ADR：**ADR-018**（权限上下文故障分级，本次同步修订 §4）、ADR-011（故障语义分级）、ADR-022（测试真实性策略）
> 词汇：module / interface / implementation / seam / leverage / locality（codebase-design）

## 一、问题总结

`getUserPermissionContext` 在 ADR-018 被改成判别式联合
（`ok | denied(not_found|inactive) | unavailable`）之后，**签发场景如何消费它**这件事被写了两遍：

```ts
// lib/auth/oauth-grant.ts（授权码兑换）
const permResult = await getUserPermissionContext(authCode.userId);
if (permResult.kind === 'denied') return { ok: false, reason: 'invalid_grant', detail: '用户不可用' };
if (permResult.kind === 'ok') await cacheUserPermissionContext(authCode.userId, permResult.context);

// lib/auth/token.ts（RT 轮换）
const permResult = await getUserPermissionContext(rt.userId);
if (permResult.kind === 'denied') throw new Error(`用户不可用（${permResult.reason}），拒绝轮换`);
if (permResult.kind === 'ok') await cacheUserPermissionContext(rt.userId, permResult.context);
```

两段注释也几乎逐字相同（都在解释"denied 必须拒绝 / unavailable 不阻断"）。

**代价一（locality）**：这条安全语义（"DB 抖动不得登出用户"）在两处独立维护。任何一处被
"顺手简化"成 `if (!permResult)`，`unavailable` 就会重新变成拒绝——而那正是 ADR-018 修掉的 bug。

**代价二（测试面）**：它只能靠**三个测试文件各自的替身开关**才被测到
（`oauth-grant.test.ts`、`oauth2-token.test.ts`、`rt-permission-failure.test.ts` 各自
`mockResolvedValue({ kind: ... })`）。也就是说，"这条分级对不对"没有一处直接打靶的地方。

### 两条路径真正的差异不是判定，而是**失败如何投递**

- 授权码兑换：返回判别式结果（OAuth 错误形状由该 module 的 interface 承诺）
- RT 轮换：**抛出**——因为它在一段"事务已提交，失败必须补偿回收刚入库的 RT"的 try 里

所以共享的应当是**判定**，投递方式属调用方。

## 二、修复方案

在 `lib/permissions.ts` 里新增 `resolveIssuancePermission(userId)`，**紧邻**
`toPermissionContextOrNull` —— 两者是同一个联合的**两个 adapter**，并列写出语义差别：

| adapter | 场景 | `denied` | `unavailable` |
|---|---|---|---|
| `toPermissionContextOrNull` | 判定 / 渲染 | 收窄为 `null`（拒绝） | 收窄为 `null`（拒绝） |
| `resolveIssuancePermission` | **签发预填充** | `{ ok: false, reason }` | `{ ok: true, prefilled: false }`（**照常签发**） |

```ts
export type IssuancePermission =
  | { readonly ok: true; readonly prefilled: boolean }
  | { readonly ok: false; readonly reason: 'not_found' | 'inactive' };
```

**`prefilled: boolean` 不是装饰**：它把"因基础设施故障跳过预填充"这条 ADR-018 分支变成
**可在 seam 上直接断言的值**——此前它只能靠观察真实 Redis 键是否被写入来间接推断。
若压成 `{ ok: true }`，"跳过预填充"与"已预填充"就同形了（R3 的教训：多义的值等于在
interface 上删掉了这一维）。

两个调用方各自保留投递方式：

```ts
const permission = await resolveIssuancePermission(userId);
if (!permission.ok) { /* 兑换：return invalid_grant ／ 轮换：throw 以触发补偿回收 */ }
```

## 三、测试面必须跟着 seam 走（本轮最大的工作量，也是最大的收益）

改完之后**五个测试文件变红**，原因是一个结构性的、值得记住的事实：

> `resolveIssuancePermission` 调用 `getUserPermissionContext` 是**模块内局部调用**，
> 而 `vi.mock('@/lib/permissions')` 只替换**导入方看到的那份导出**。于是
> "mock 掉读上下文的那一半"这条老路在 seam 搬家后**彻底失效**——mock 还在，
> 但已经拦不住任何东西（更糟：裸的部分替换会让 `resolveIssuancePermission`
> 变成 `undefined`，被补偿回收兜住后表现为"轮换返回 null"）。

处置不是"把 mock 搬到新 seam"，而是**改用真实状态注入**（ADR-022 的方向）：

| 文件 | 原替身 | 现在 |
|---|---|---|
| `oauth-grant.test.ts` | mock 上下文（3 支） | **零替身**：`denied` 由真实 `DISABLED` 用户行驱动；`unavailable` 由真实 `:unavailable` 标记驱动 |
| `oauth2-token.test.ts` | mock 上下文（ok fixture） | **零替身**（该替身已不再影响任何断言，属"死替身"，直接删） |
| `rt-permission-failure.test.ts` | 开关式 `getUserPermissionContext` 替身 | **零替身**：`await markUnavailable()` 写真身会读的那个键 |
| `rt-reuse-detection.test.ts` | 裸部分替换（两个导出） | **零替身**（fixture 与真实 DB 结果一致） |
| `authorization-code-storage.test.ts` | 裸部分替换（两个导出） | **零替身** |

`unavailable` 的注入方式尤其值得记：真身 `getUserPermissionContext` 的第一步就是查
`:unavailable` 标记（TTL 5s，为吸收重试风暴而设），因此**写那个键 = 让真身按自己的语义
返回 unavailable**。注入的是**状态**，不是实现——比 mock 掉一半更接近生产。

**净效果：5 个文件的权限替身全部消失，签发路径不再依赖任何上下文替身。**

## 四、验证

### 变异验证（两次，各自精确）

| 变异 | 结果 | 说明 |
|---|---|---|
| `unavailable` 谎报为 `prefilled: true` | **1 红 / 3 绿** | 只有 ADR-018 那条变红 ⇒ 该分支有独立分辨力 |
| `denied` 由"拒绝"改为"放行" | **2 红 / 2 绿** | 只有 `not_found` 与 `inactive` 两条变红；`unavailable` 那条保持绿 |

两种变异下正向对照（ACTIVE 用户 → `ok` 且真实回填）都保持绿。哈希
`fc374e2d6f28a7ed…acbf7c` 逐字还原。

### 一次"变异没生效"的实测（ADR-021 的教训再现）

第二次变异我最初写错了位置：把新分支**插在原有 `denied` 检查之后**，于是那行是
**死代码**——测试全绿。我因为"预期这里该红"而回头看，才发现变异只改了文本、没改行为。
**这与 ADR-021 记录的"变异验证本身需要被验证"是同一件事**，且这次是靠"绿得不对"发现的：
把变异注入后必须先确认它真的改变了行为（本题可用"原有分支在前"的静态阅读，或直接看
测试是否按预期变红），再解释测试结果。

### 门禁

| 门禁 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错误 |
| `eslint`（改动文件） | 0 error；1 warning 为既有（已用 `eslint --stdin` 对 HEAD 版本证明） |
| `pnpm test` | **85 文件 / 713 用例全绿**（修复前 84 / 709；新增 `issuance-permission.test.ts` 4 例） |

## 五、最佳实践（可复用）

1. **同一个判别式联合的两个消费场景，就是两个 adapter。** 把它们并排放在联合的定义旁边
   （本例：`toPermissionContextOrNull` 与 `resolveIssuancePermission`），语义差别一眼可读；
   写在两个业务文件里，差别就只能靠对照阅读发现，而"顺手简化"会悄悄抹掉它。
2. **"失败如何投递"属调用方，"判定"属 module。** 同一条判定在两个调用方一个返回值、
   一个抛异常是完全合理的——把它当成"不一致"去强行统一，会破坏其中一方的补偿逻辑。
3. **seam 搬家时，旧替身会静默失效——这比它变红更危险。** 模块内局部调用绕过
   `vi.mock`，于是"mock 还在、却拦不住"；裸的部分替换还会让新导出变 `undefined`。
   搬家后应逐文件确认替身是否仍**有效**，而不是只确认测试是否还绿。
4. **能用状态注入就不要用替身。** `unavailable` 曾经"真实 PostgreSQL 无法按需变为不可用，
   只能 mock"——但真身本来就有 `:unavailable` 标记这条路径。**先找真身已有的注入点**，
   再考虑替身；本例因此把 5 个文件的替身清零。
5. **变异注入后先确认它改变了行为。** 插在既有分支之后的变异是死代码，会给出"测试抓不到"
   的假结论（ADR-021 已记过一次，本次再现）。判据：把变异后的代码读一遍控制流，
   或确认变红的是**预期的那些**断言而不是"全绿/全红"。
