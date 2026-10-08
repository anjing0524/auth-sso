# ADR-018: 权限上下文解析结果可判别 —— 缓存性故障不再升级为登出

| 属性       | 值                                                                    |
|------------|-----------------------------------------------------------------------|
| **状态**   | implemented (2026-10-08)                                              |
| **日期**   | 2026-10-08                                                            |
| **决策者** | Auth-SSO 团队（improve-codebase-architecture 架构评审候选 ⑥）          |
| **影响范围** | `lib/permissions.ts`（`getUserPermissionContext` 返回类型）、`lib/auth/token.ts`、`lib/auth/oauth-grant.ts`、`lib/auth/check-permission.ts`、`app/api/me{,/permissions}/route.ts`、`app/(dashboard)/layout.tsx`、`app/profile/page.tsx` |

## 背景

`getUserPermissionContext(userId)` 返回 `UserPermissionContext | null`，而 `null` 同时表示**四种语义完全不同**的事：

| 位置 | 触发条件 | 性质 |
|---|---|---|
| `:84` | Redis 命中 `:null` 标记 | 用户不存在（**否决性**） |
| `:128` | DB 查不到用户 | 用户不存在（**否决性**） |
| `:134` | 用户状态非 `ACTIVE` | 被封禁（**否决性**） |
| `:194` | DB 查询抛异常 | **基础设施故障**（ADR-011 判为缓存性） |

前三种是"必须拒绝"，第四种按 ADR-011 是"缓存性数据，应降级"。**interface 把它们压成同一个 `null`，调用方无从分级——只能一律拒绝。**

### 直接后果：DB 抖动 = 用户被登出

`rotateRefreshToken` 在事务提交后的后置步骤里：

```ts
const permCtx = await getUserPermissionContext(rt.userId);
if (!permCtx) throw new Error('用户权限上下文不可用（fail-close）');
```

DB 一次瞬时抖动 → `throw` → 补偿回收刚入库的新 RT → `return null` → 客户端收到 `invalid_grant`。**用户被登出，而且旧 RT 已被作废、无法恢复。**

AD-011 早已判定权限上下文是缓存性数据（"DB 是永久真源，Redis 只是可重建缓存"），但该判定只覆盖了"Redis 挂 → 降级查库"这一段。**"库也挂了"这一档没有规定，实现于是落回 fail-close。** 本 ADR 补上这一档并落实。

## 决策

### 1. 返回可判别的结果，而不是 `null`

```ts
export type UserPermissionContextResult =
  | { readonly kind: 'ok';          readonly context: UserPermissionContext }
  | { readonly kind: 'denied';      readonly reason: 'not_found' | 'inactive' }
  | { readonly kind: 'unavailable' };
```

三分法直接对应 ADR-011 的判据：`ok` 是用据，`denied` 是否决性数据，`unavailable` 是缓存性故障。

### 2. `unavailable` 不得被缓存成"用户不存在"

原实现把瞬时故障也走 `:null` 标记（60s TTL）的路径风险很大——那会把一次 DB 抖动**固化成 60 秒的"用户不存在"**。因此：

- `denied:not_found` 仍写 `:null`（60s）——防穿透枚举，语义正确。
- `unavailable` 写**独立的** `:unavailable` 标记，TTL 仅 **5 秒**。理由：完全不缓存会在 DB 抖动时让同用户的重试全部穿透到 DB（雪崩）；5 秒足以吸收重试风暴，又不会把故障当真。

两个标记刻意分开，使"用户不存在"与"暂时查不出来"在缓存层也不混淆。

### 3. 判定场景收窄为一处，而不是散落各调用点

绝大多数调用方（鉴权、页面渲染、`me` 端点）**不需要**区分 `denied` 与 `unavailable`——两者都不构成授权依据。若强求它们各自 pattern match，只是把降级决策散播到 7 个地方，正是本 ADR 要消除的形状。

因此提供：

```ts
export function toPermissionContextOrNull(
  result: UserPermissionContextResult,
): UserPermissionContext | null {
  return result.kind === 'ok' ? result.context : null;
}
```

**降级决策集中在此一处。** 判定场景用这个收窄函数，行为与修复前逐位一致。

### 4. 只有"缓存预填充"场景消费完整结果

| 调用方 | 语义 | `denied` | `unavailable` |
|---|---|---|---|
| `rotateRefreshToken`、`exchangeAuthorizationCode` | **预填充** | 拒绝（否决性） | **跳过预填充，照常签发** |
| 判定/渲染场景（5 处） | 判定 | 拒绝 | 拒绝（经收窄函数） |

预填充之所以可以降级：**签发令牌不依赖权限上下文**。跳过预填充的唯一后果是该用户下次鉴权时解析一次（即 ADR-011 的 fail-open 路径）。而 `denied` 仍拒绝——用户已被删除或禁用，不该拿到新令牌。

## 后果

**收益**
- ADR-011 的分级第一次在**实现层面**落实：`unavailable` 不再让用户被登出。
- `null` 的四义坍缩被消除；失败原因成为类型的一部分。
- 降级决策集中在 1 处（收窄函数），而非散落 7 处。
- 新增 `rt-permission-failure.test.ts` 6 例钉住两种语义，经**变异验证**（把实现退回 fail-close 后，仅 `unavailable` 的 2 例变红，`denied` 的 4 例仍绿——证明两组语义确实不同）。

**代价**
- `getUserPermissionContext` 是公开面变更，7 个调用点需调整（判定场景一行改为经收窄函数）。
- 缓存新增一个 key 后缀（`:unavailable`），Redis 键空间多一项。
- `permission-enforcement.test.ts` 的 mock 需补 `toPermissionContextOrNull`。该 mock 用**真实语义**而非空实现——mock 掉它等于把待测逻辑替换成测试自己的假设。

**未覆盖**：`checkPermission` 在 `unavailable` 时仍返回 403（经收窄函数）。理由：鉴权需要判据，而 `unavailable` 不构成判据。若要在此处也体现"降级"，正确做法是返回 503 而非 403（区分"无权限"与"暂时无法判定"），但那会改变 API 契约，属独立决策。

## 验证

- `tsc` 0 错误。
- `pnpm test` 54 文件 / 452 用例全绿（新增 6 例）。
- `lint` 0 errors。
- 变异验证：退回 fail-close → `unavailable` 2 例失败、`denied` 4 例通过。

## 相关 ADR

- **ADR-011**: 故障语义分级（本 ADR 落实其判据，并补上"库也不可用"这一档）
- ADR-014: 数据范围授权门面（同一手法：把散落的判定收为单一可测 module）
- ADR-017: 授权码兑换深 module（同一纪律：失败可判别而非压成 `null`）
- ADR-004: 无状态 JWT + Redis 黑名单（键空间定性为"可重建缓存"）
