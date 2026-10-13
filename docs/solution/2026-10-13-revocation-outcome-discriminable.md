# 撤销原语的成败必须可判别 —— 「永不抛出」不等于「不必回报」（架构评审 R2 候选 R3）

> 日期：2026-10-13
> 来源：improve-codebase-architecture 架构评审第二轮（Strong 候选 R3，报告 `.arch-review/architecture-review-20261013-100205.html`）
> 关联 ADR：ADR-011（故障语义分级：否决性 fail-close / 缓存性 fail-open）、ADR-018（权限上下文故障分级）、**ADR-016/017**（同一纪律：「让失败/缺失可判别，而不是压成哨兵」）
> 词汇：module / interface / seam / leverage / locality（codebase-design）

## 一、问题总结

`lib/session/revoke.ts` 的 `revokeUserAccessByUserId` 是 jti 撤销的唯一 seam。它有两条性质，而这两条性质**组合**出了一个静默的安全缺口：

1. **它永不抛出**——整个函数体包在一个 try/catch 里，所有失败路径都 `return`。
2. **它的返回值是 `number`**——而 `0` 同时表示「该用户没有活着的 AT」与「Redis 挂了，一个都没撤成」。

于是调用方面对一个两难：按"失败会 throw"写 catch（**不可达**），还是按"返回 0 就是没事"（**把故障读成正常**）。8 处调用点选了前者，全部不可达：

| 调用点 | 当时形态 |
|---|---|
| `lib/auth/token.ts:399-406` | `try { const count = await … } catch { return 0 }` |
| `lib/account/change-password.ts:97-101` | try/catch + `log.error` |
| `lib/account/reset-password.ts:93-97` | try/catch；注释自认「属历史遗留，保留仅为防御未来改动」 |
| `api/auth/logout/route.ts:96-100` | try/catch + `log.error` |
| `api/users/[id]/reset-password/route.ts:94-98` | try/catch + `log.error` |
| `(dashboard)/users/actions.ts:163-167` | try/catch + `log.error` |
| `(dashboard)/users/actions.ts:278-282` | try/catch + `log.error` |
| `lib/auth/token.ts` 的 `revokeAllRefreshTokens` | 同上（编排层再吞一层） |

**后果**：Redis 全挂时，「紧急撤销失败」连一行日志都没有。更糟的是 `users/actions.ts:161`
的注释承诺了**相反的保证**——「关键安全操作必须 await（Redis 不可达时撤销失败会留下有效旧 Token）」
——读者会以为失败至少会被记下来，而那个 catch 永不执行。

### 为什么它能长期存活

`force-logout-revocation.test.ts` 把这个错误语义**钉成了契约**：

```ts
// 不得抛出：Redis 抖动不应使"任何人都无法被强制下线"；
// 返回 0 表示本次没有可计数的 JTI 撤销（而非失败）
await expect(revokeAllRefreshTokens(USER_A)).resolves.toBe(0);
```

测试的**意图**是对的（Redis 故障不得阻断 RT 撤销、不得抛出），但它把**形状**也钉住了，
于是 `0` 的多义性被写成了规范。这与 ADR-014 记录的「子树谓词缺陷被写进测试期望」同源：
**把缺陷固化成规范后，任何符合直觉的实现都会让测试变红。**

## 二、修复方案

### 1. 把已存在的 `UserRevokeOutcome` 升为公开 seam 的一部分

`{ revoked, failed }` 本来就在（但**未导出**，只给内部的批量撤销用，公共函数刻意"保持签名不变
以避免扩散到 7+ 个调用方"）。现在把它导出，并让公共函数直接返回它，删掉那个丢弃 `failed`
的数字访问器：

```ts
export interface UserRevokeOutcome {
  readonly revoked: number;   // 本次写入黑名单的 jti 数量
  readonly failed: boolean;   // 是否未真正执行（Redis 不可用或操作抛错）
}
export async function revokeUserAccessByUserId(userId: string): Promise<UserRevokeOutcome>
```

**为什么不是加一个可选的 `onFailure` 回调或抛错**：抛出会破坏 ADR-011 的分级（jti 属缓存性
故障，不得升级为阻断）；回调会把「谁在听」塞进 interface。判别式返回值让**成败成为值**，
与 ADR-016/017 的既有纪律一致。

### 2. 编排层只描述"会部分失败的那一层"

`revokeAllRefreshTokens` 的返回值改为 jti 层的 `UserRevokeOutcome`：RT 层走 DB、**失败即抛**
（否决性 fail-close），所以「正常返回」本身就说明 RT 层已完成；返回值只需描述**会部分失败的
那一层**。它的 try/catch 随之删除（不可达）。

### 3. 调用点分两类，且都写下理由

- **需要上报的**：`force-logout` 的响应新增 `jtiRevocationFailed`，并把 message 分成两支。
  管理员因此能区分「该用户没有活着的 AT」与「Redis 不可用、一个都没撤成」。
- **按 ADR-011 有意忽略的**：登出 / 改密 / 重置密码 / 用户状态变更——删除死 catch，
  **写明「失败不阻断、由 module 在发生处记日志」**。失败日志只记一次，且记在拥有该知识的
  module 里（locality），而不是复制到 8 个调用点（那正是"8 处各做各的"这个病的复现）。

顺带把 `revokeUserAccessByUserId` 的失败日志补上 `userId`（原先只有 error message，
排查时定位不到用户）。

## 三、同类普查（本仓纪律）

普查全部撤销原语的失败语义：

| 原语 | 故障分级 | 失败如何传达 | 处置 |
|---|---|---|---|
| `revokeUserRefreshTokens`（及 `revokeRefreshToken*` 族） | 否决性 fail-close | **抛出** | 不动（正确） |
| `revokeUserAccessByUserId` | 缓存性 fail-open | **本轮前**：多义 `number` → **本轮后**：`UserRevokeOutcome` | **本轮修复** |
| `revokeJti` | 缓存性 fail-open | 返回 `void`，仅内部记日志 | **不改返回值**：全仓唯一调用方（登出）丢弃结果，加一个没人消费的信号是投机。但发现其调用方的 catch **同属不可达**（`logout/route.ts:51-55`），已删 |
| `revokeUserToken` | 缓存性 fail-open | 转发 `revokeJti` | 不动 |
| `isJtiRevoked` | **否决性 fail-close** | 故障时返回 `true`（拒绝） | 不动——这是 ADR-011 的既定决策，不是计数问题 |
| `revokeUsersAccessByUserId`（批量） | 缓存性 fail-open | `{succeeded, failed}` | 不动（已是判别式；本轮它的失败计数随公共 seam 一起变得更可靠） |

**结论**：同类缺陷 2 处（`revokeUserAccessByUserId` 的多义返回值、`revokeJti` 调用方的死 catch），
均已修复；其余 4 个原语逐条给出不改的理由。

## 四、验证

### 变异验证（把 catch 里的 `failed: true` 改回 `false`，即恢复旧的谎言）

```
× **Redis 故障不得阻断 RT 撤销，且必须如实回报失败**（ADR-011/018 分级）
× **Redis 故障时如实回报未撤成**（不得把"一个都没撤成"报成 0 个可撤）
× **全部失败 → failed 必须等于用户数**（旧实现的 rejected 恒为 0，此断言会失败）
× 部分失败 → 计数如实反映（不得混同为全成或全败）
× 超过批大小（50）仍逐一统计，不因分批而丢失失败
Tests  5 failed | 11 passed (16)
```

保持绿的 11 例全是**成功路径**：真实撤销计数（3 / 5）、幂等再消费（0 但 `failed: false`）、
RT 跨 client 撤销、批量全成功、空数组。也就是说这组测试**能分辨"没撤成"与"没有可撤"**——
这正是本候选要买的东西。变异前后哈希一致（`fb93aba00170a9b2…fb03bdd`）确认逐字还原，
并确认变异落在含 `userId` 的那处 catch（ADR-021 的教训：变异本身也要被验证）。

### 编译器驱动的连带修正（ADR-022 在起作用）

改签名后 `tsc` 立刻点名 **3 处类型化 mock 工厂**（`token-claims-binding` / `user-api` /
`user-role-api`）——它们的 `vi.fn(async () => 0)` 与新类型不再兼容。这是 ADR-022 §「契约交给编译器」
的正面证据：形状漂移在**编译期**暴露，而不是等运行时某个断言变绿/变红。其中
`user-role-api` 的注解理由原文是「只提供『撤销已完成/**计数为 N**』这类输入」，形状变了之后
理由也必须同步改（`CODING_STANDARDS.md` §2：注解里的行为断言必须与代码实际形态相符）。

### 门禁

| 门禁 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错误 |
| API project | **55 文件 / 503 用例全绿** |
| `pnpm test` | 82 文件 / 695 用例全绿（R3 新增 1 例响应契约用例） |

## 五、最佳实践（可复用）

1. **「永不抛出」不是「不必回报」，而是"回报是唯一通道"。** 一个函数若把异常都吞掉，
   它的返回值就成了调用方唯一的失败信号——此时返回一个多义的基本类型（`0`/`null`/空数组）
   等于**在 interface 上删掉了失败这一维**。写 fail-open 的 module 时，返回值必须是判别式的。
2. **看到 `try/catch` 先问"被调函数真的会抛吗"。** 一个不可达的 catch 比没有 catch 更坏：
   它让读者以为失败已被处理，于是没人去修真正的通道（本仓还出现过注释承诺了该 catch 会做的事）。
3. **测试可以钉意图，但要小心别把形状一起钉死。** `resolves.toBe(0)` 把「Redis 故障不阻断」
   这一正确意图与「用 0 表示」这一错误形状焊在了一起。断言判别式结果（`toEqual({revoked:0,failed:true})`）
   能同时表达意图与形状，且**多义性无处藏身**。
4. **失败日志要记在拥有该知识的 module 里，只记一次。** 8 个调用点各写一句 `log.error`
   既是重复又是幻觉（它们根本执行不到）；收在 module 内让错误信息（含 userId）只有一处来源。
5. **签名收紧后先跑 `tsc` 再跑测试。** 类型化工厂会在编译期把"哪些测试依赖旧形状"一次点全；
   这比逐个等测试运行失败快得多，也顺带证明了 mock 与真身之间存在真实的类型联系（ADR-022 §11）。
