# 批量部分失败的聚合收成一个原语 —— 成败由「是否抛出」决定（架构评审 R2 候选 R5）

> 日期：2026-10-13
> 来源：improve-codebase-architecture 架构评审第二轮（Strong 候选 R5，报告 `.arch-review/architecture-review-20261013-100205.html`）
> 关联 ADR：ADR-011（故障语义分级）、ADR-020 决策 2（「把保证放在函数内而非调用点，调用点未来还会增加」）、R3 的 solution（同一纪律：让失败可判别）
> 词汇：module / interface / implementation / seam / leverage / locality（codebase-design）

## 一、问题总结

「按 50 一批并发执行、单项失败不影响其他项、最后报告成功/失败计数」这段逻辑在本仓被
**抄了两遍**，而且两份的成败**极性相反**、结果类型各起一个名字：

| 位置 | 单次结果 | 批量结果 |
|---|---|---|
| `lib/permissions.ts`（`settleUserBatches`） | `RefreshOutcome{ ok }` | `BatchRefreshResult` |
| `lib/session/revoke.ts`（内联循环） | `UserRevokeOutcome{ revoked, failed }` | `BatchRevokeResult` |

两处注释甚至**互相点名**同一形态：

- `permissions.ts`：「这与 `revokeUsersAccessByUserId` 曾是同一形态。」
- `revoke.ts`：「这与 `revokeAllRefreshTokens` 曾把『永不失败的调用』当作计数依据属同一形态。」

### 代价不是"重复"，而是同一个 bug 被独立修了三次

`a7fa3cb`（批量撤销的失败计数恒为 0）→ `ad530d6`（批量刷新的失败计数恒为 0，提交自述
「与前一处的修法一致」）→ `7d38152`（**第三次**才发现根因更深）。三次的共同形态是：

```ts
const results = await Promise.allSettled(items.map(operation));
failed = results.filter(r => r.status === 'rejected').length;   // 恒为 0
```

因为被调方**整体 try/catch、永不 reject**（出错只记日志并返回一个"没问题"的值），
于是"批量成功"恒打印、失败告警永不触发。

而**第三次**修复证明：把聚合侧改对也还不够——`refreshUserPermissionCache` 当年对分级联合
做了真值判断（对象恒真），**自报的 `ok` 是假话**，聚合侧再正确也无用。

**结论**：真正的缺陷在 interface——它允许被调方"自报成败"，而那个值可以是错的。

## 二、修复方案

新建 `lib/batch.ts`（唯一原语），interface **刻意不接受任何成败标记**：

```ts
export interface BatchOutcome { readonly succeeded: number; readonly failed: number; }

export async function settleInBatches<T>(
  items: readonly T[],
  operation: (item: T) => Promise<void>,   // 抛出即失败
): Promise<BatchOutcome>
```

**成败判据唯一：`operation` 抛出即失败。** 抛出是语言自身的机制，**不能被算错**；
自报的布尔值能。批大小（50）作为实现细节收进模块，不再是两个文件里的同名常量。

两个消费方各写**一层薄 adapter**，把"判别式结果"翻译为抛出——翻译只此一处：

```ts
// permissions.ts
await settleInBatches(userIds, async (userId) => {
  const outcome = await refreshUserPermissionCache(userId);
  if (!outcome.ok) throw new Error('权限缓存刷新未生效');
});
// revoke.ts
await settleInBatches(userIds, async (userId) => {
  const outcome = await revokeUserAccessByUserId(userId);
  if (outcome.failed) throw new Error('Access Token JTI 撤销未执行');
});
```

**为什么不让 `operation` 返回 `{ ok: boolean }` 而由聚合侧判真假**：那正是被修三次的那个形态
——聚合侧要"重新解释"下游的成败标记，解释就会出错（第三次的根因）。**判断必须发生在
唯一一处**（adapter），聚合侧只认异常。

**失败日志**：聚合原语不记日志（它没有领域知识）；`operation`/被调方在发生处记录，
批量函数记一条汇总（成功 N / 失败 M）。两个消费方的原有日志行为保持不变。

## 三、同类普查（本仓纪律）

普查全部"并发聚合 + 成败统计"点位：

| 检查项 | 结果 |
|---|---|
| `Promise.allSettled` 的其他用法 | **无**（仅剩注释里的历史叙述） |
| 其他分批循环（`index += ` / `slice(index`） | **无** |
| 其他批大小常量（`BATCH_SIZE`） | **无** |

**结论**：该形态在全仓恰好 2 处，均已收口——不存在"第三个拷贝"。

## 四、验证

### 变异验证：把「failed 恒为 0」重新注入共享原语

```
× **DB 故障 → failed 必须等于用户数**（旧实现把 unavailable 计成成功）
× **Redis 故障 → failed 必须等于用户数**（Redis 抛错路径）
× 用户不存在（denied:not_found）→ 缓存未被刷新，计入 failed 而非 succeeded
× **抛出的项计为失败，未抛出的计为成功**（唯一判据，不读任何自报标记）
× **单项失败不影响其他项**（逐项隔离，全部项都被尝试）
× **全部抛出 → failed 等于项数**（正是当年"恒为 0"的那个数字）
× 跨批不丢计数（120 项 > 批大小 50，全部逐项处理）
× **全部失败 → failed 必须等于用户数**（旧实现的 rejected 恒为 0，此断言会失败）
× 部分失败 → 计数如实反映（不得混同为全成或全败）
× 超过批大小（50）仍逐一统计，不因分批而丢失失败
Tests  10 failed | 6 passed (16)
```

**10 条来自 3 个文件**——其中 6 条是 `revoke-batch-result.test.ts` 与
`permission-cache-refresh-result.test.ts` 里**当年为那两次独立修复写的**回归测试。
这正是收口买到的东西：同一个 bug 再也不可能只在一份拷贝里复活。
保持绿的 6 例是成功路径与分批并发断言（计数不受影响）。变异前后哈希
`f6e4716bc8a88d19…5405cb` 逐字一致。

### 门禁

| 门禁 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错误 |
| `eslint`（改动文件） | 0 error、0 warning |
| `pnpm test` | **84 文件 / 709 用例全绿**（修复前 83 / 703） |

## 五、最佳实践（可复用）

1. **"成败"不要设计成被调方自报的标记，要设计成语言机制。** 抛出/不抛出无法被算错；
   `{ ok: boolean }` 会在某次「顺手改成真值判断」之后开始撒谎——本仓为此修了三次。
   若必须保留判别式结果（如需要区分 `denied` 与 `unavailable`），就让**唯一一层 adapter**
   把它翻译成抛出，聚合侧只认异常。
2. **同一段逻辑的第二份拷贝，成本不是维护量，而是 bug 会被独立修 N 次。**
   两次独立修复 + 一次"修完还不生效"，都指向"这段逻辑没有唯一归属"。
   判据：如果两条注释在互相点名"这曾是同一形态"，那就是同一个 module 缺位。
3. **判据要落在唯一一处，且能被测试直接打靶。** 本原语的判据是"抛出即失败"，
   因此一条变异（把失败计成成功）会同时打中三个文件的 10 条断言——包括历史回归网。
   收口之后，**旧的回归测试自动升级为共享原语的守卫**，这是收口最便宜的红利。
4. **分批参数是实现细节，不是 interface。** 两个调用点曾各自持有 `USER_BATCH_SIZE = 50`；
   把它收进模块后，"批大小是多少"只有一个答案，也不会有人从调用点传一个危险值（如 10000）。
5. **普查要查"第三种可能的位置"，不只是"已经看到的位置"。** 本次普查刻意搜了
   `allSettled`、分批循环、批大小常量三类模式，确认全仓恰好 2 处——否则"收口"只是
   把已知的两处合并，第三处仍会以不同写法存在。
