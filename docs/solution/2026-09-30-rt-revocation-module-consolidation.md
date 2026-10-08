# RT 撤销原语收口 —— 领域维度模块化（架构评审候选 ①）

> 日期：2026-09-30
> 来源：improve-codebase-architecture 架构评审（Strong 候选 ①，报告 `/tmp/architecture-review-auth-sso.html`）
> 关联 ADR：ADR-004（无状态 JWT + 黑名单）、ADR-012（RT 绑定 client / 家族撤销）、ADR-013（per-client aud）
> 词汇：module / interface / seam / depth / leverage / locality（codebase-design）

## 一、问题总结

"撤销一个 / 一族 / 一批 Refresh Token"这一领域概念**没有 Module**，只有 12 份相同 SQL（`set({ revoked: new Date() })`）的编排拷贝，散落 5 个文件：

| 文件 | 处数 | 语义 |
|------|------|------|
| `lib/auth/token.ts` | 5 | tx 版家族撤销、db 版家族撤销（两份逐字拷贝）、轮换单条、补偿回收、按用户 |
| `api/auth/logout/route.ts` | 2 | tokenHash 单行、按用户防御纵深 |
| `api/auth/oauth2/revoke/route.ts` | 1 | tokenHash + client 归属限定（RFC 7009 §2.1） |
| `(dashboard)/clients/actions.ts` | 2 | 按 client 撤销 + `isNull(revoked)` 真实计数 |
| `api/clients/[id]/tokens/route.ts` | 2 | 同上（tx 内 + 审计） |

**架构定性**：不是模块太浅，而是该深的 Module 根本不存在。每份拷贝独立决定 client 限定要不要加、家族级联还是单条、是否在 tx 内——安全语义靠逐处读代码分辨（无 locality）；撤销策略任何变更（加 revoked_reason、审计钩子）要改 12 处。Deletion test：无 Module 可删，复杂度已经重现了 12 次。

## 二、修复方案

新建 `lib/auth/token/revocation.ts`（`token/` 子目录下沉，signing-keys.ts 先例），五个**按领域维度命名**的函数，全部 executor-first（`db | tx | TestDb`）：

| 函数 | where | 返回 | 语义来源 |
|------|-------|------|---------|
| `revokeRefreshTokenById` | id | void | 轮换、补偿回收 |
| `revokeRefreshTokenByTokenHash` | tokenHash（可选 client 限定） | void | 登出、RFC 7009 |
| `revokeRefreshTokenFamily` | userId + clientId | void | RFC 9700 家族级联（tx/db 双拷贝合一） |
| `revokeUserRefreshTokens` | userId | void | 强制下线 |
| `revokeClientRefreshTokens` | clientId（+ids）且仅未撤销行 | **count** | 管理端真实计数 |

关键设计决策：

1. **维度用函数名编码，不用 where 条件参数化**——调用方 grep 函数名即审计语义，不给调用方拼装 where 碎片的机会（那只是把散落下移，seam 仍泄漏）。
2. **计数语义与覆盖语义分离**——覆盖式函数（void）重复标记幂等；只有管理端函数走 `isNull(revoked) + returning` 返回真实翻转计数，重复调用不虚增。
3. **职责不越界**——AT/jti 撤销（Redis 侧）留在 `lib/session/revoke.ts`；`revokeAllRefreshTokens` 保留为编排函数（RT 撤销 + jti 批撤的双层闭环组合点），签名不变。
4. **兼容**——`revokeRefreshTokenFamily` 从 token.ts re-export（签名新增 executor 首参），token 端点重放取证的导入路径不变。

## 三、测试

新增 `__tests__/api/rt-revocation.test.ts`（真实 DB，11 用例矩阵）：byId 定点性、tokenHash ±client 限定（DoS 隔离）、家族级联不牵连其他 client / 其他用户、byUser 跨 client、管理端计数幂等、**事务回滚时撤销一并回滚**（验证 tx executor 真实性）。既有 `oauth2-token.test.ts` 断言随签名更新（`expect.anything(), USER_ID, 'portal'`）。

验证结果：`test:api` 24 文件 228 用例全绿；`typecheck` 0 错；`lint` 0 错。

## 四、同类问题审阅（架构评审已挂号，按推荐顺序待做）

同一模式（"安全关键编排散落 N 份拷贝"）在本仓库还有三处，按优先级：

1. **候选 ②（Strong）**：数据范围守卫三连 `getUserRoleDeptIds + canAccessDept + ForbiddenError` ≈ 20 处，且 tx 内/外两种写法并存（TOCTOU 窗口）——收口为作用域守卫编排 Module。
2. **候选 ④（Strong）**：Portal callback 与 Gateway 两套 OAuth Client 实现，nonce fail-close 语义已漂移——先决策 Portal 直连形态是否保留。
3. **候选 ⑤（Strong）**：audit 模块 Interface 自相矛盾（fire-and-forget 文档 vs guard await 翻转已提交事务；`x-action-*` 死头）。

## 五、最佳实践沉淀

**判别信号**：`grep -rn "<同一段 SQL/校验模式>" | wc -l ≥ 3` 即散落；若各份拷贝在某个布尔维度（client 限定？in tx？计数？）上答案不一致，说明语义已漂移，升级为 Strong。

**收口套路（本次可复用模板）**：

1. 按调用方语义聚类出**领域维度**（≤5 个），每个维度一个具名函数——拒绝单函数 + where 条件参数化；
2. 统一 **executor-first** 签名（`db | tx` union 类型），消除"tx 版 / db 版双拷贝"；
3. **返回值语义分档**：覆盖式返回 void，管理端计数返回 number——不要为了统一让 void 函数返回没人消费的 count；
4. 跨侧联动（RT 行撤销 vs jti 黑名单）用**编排函数组合**，Module 之间不互相伸手；
5. 矩阵测试落在新 Module 的 interface 上（每维度 ≥1 用例 + 回滚用例），调用方测试只留协议层断言。
