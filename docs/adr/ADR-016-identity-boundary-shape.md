# ADR-016: 身份解析只暴露 `userId` 与时间字段 —— 移除空字符串哨兵 claims

| 属性       | 值                                                                    |
|------------|-----------------------------------------------------------------------|
| **状态**   | implemented (2026-10-08)                                              |
| **日期**   | 2026-10-08                                                            |
| **决策者** | Auth-SSO 团队（improve-codebase-architecture 架构评审候选 ④）          |
| **影响范围** | `domain/auth/types.ts`（`ResolvedIdentity`）、`lib/auth/verify-jwt.ts`、`lib/auth/server-logger.ts`、`app/api/me/route.ts`、11 个测试夹具 |

## 背景

`resolveIdentity()` 是 Portal 的身份边界：把「Gateway HMAC 信任路径」与「自验签 JWT Cookie 兜底」两条来源折叠成同一个 `ResolvedIdentity`。它的返回类型曾是：

```ts
export interface ResolvedIdentity {
  userId: string;
  /** JWT 完整声明（Gateway 路径下从 Cookie 快速解码，自验签路径下完整验证） */
  claims: PortalJwtClaims;
}
```

而实现里有一条路径**用空字符串伪造这个对象**：

```ts
const EMPTY_CLAIMS: PortalJwtClaims = { sub: '', iss: '', aud: '', jti: '' };

// 极端情况：有 X-User-Id 但无有效 JWT → 降级最小 claims
return { userId: gatewayUserId, claims: { ...EMPTY_CLAIMS, sub: gatewayUserId } };
```

### 为什么这是架构摩擦

`PortalJwtClaims` 声明 `iss: string` / `aud: string | string[]` / `jti: string`（**非空**）。实现在这条路径上给出 `''`。于是：

- **类型在说谎**：接口承诺的不变量（这些字段存在且非空）与实现不符。
- **不变量被推给调用方**：源码注释自己承认——*"下游消费方（如 `canAccessDept`）需自行处理空 aud/jti，不可假设必填字段非空"*。**接口把不变量写成了散文。**
- **静默退化风险**：任何新调用方把 `claims.jti` 当真值用（例如去做撤销判定），拿到的 `''` 就是一个语义错误的输入，而且不会有任何编译期或运行期提示。

## 决策前的实测

在讨论"该用什么类型表达两条路径的差异"之前，先测了 `claims` 到底被谁消费：

| 消费点 | 读的字段 | 与 `userId` 的关系 |
|---|---|---|
| `lib/auth/server-logger.ts:42` | `claims.sub` | **恒等于 `userId`**（两条路径都是） |
| `app/api/me/route.ts:31`（解构） | `claims.exp`、`claims.iat` | 仅用于响应里的 `tokenInfo` |

**`claims` 在全部生产代码中只有这两个消费者**，而其中一个读的字段恒等于另一个已存在的字段。也就是说：`claims` 这个对象**从未被真正需要**——它一直是哨兵值的载体。

> **两次自我纠正，同一条教训。** 我最初 grep `.claims`，漏掉了 `me/route.ts` 的解构形态（`const { userId, claims } = identity`）；typecheck 把它暴露出来后，我又漏掉了 `me-endpoints.test.ts:182` 的同类解构，是**第二次 typecheck** 才捕获。
>
> 结论：**`grep` 某一种属性访问形态不足以判定"该字段无人使用"**——解构、别名、展开（`...identity`）都不会命中 `.claims`。判定"字段可删"必须以**编译器确认**为准（删掉类型成员后 `tsc` 零错误），而不是以 grep 计数为准。这是本 ADR 最可复用的部分。

## 决策

### 1. `ResolvedIdentity` 只暴露 `userId` + 两个显式时间字段

```ts
export interface ResolvedIdentity {
  userId: string;
  /** Access Token 过期时间（epoch 秒），无法确定时为 null */
  expiresAt: number | null;
  /** Access Token 签发时间（epoch 秒），无法确定时为 null */
  issuedAt: number | null;
}
```

删除 `EMPTY_CLAIMS`。`verify-jwt.ts` 内新增私有 `toIdentity(userId, claims)`，把 JWT 载荷**折叠**为这三个字段——只把调用方真正需要的东西带出 seam，而不是整个 claims 对象。

### 2. aud 复核留在 seam 内，不越过边界

Gateway 信任路径原先解码 token 既做 aud 复核、又把整个 claims 返回给调用方。现改为：**复核在 `verify-jwt.ts` 内部完成，解码结果不外传**。自验签路径不再需要把 `claims` 交给调用方，因为 `verifyAccessToken` 已经完成 iss/aud/typ/exp/jti 全套校验。

### 3. 不做的事：不把 claims 换成"可选化"或联合类型

权衡过三种表达"claims 可能不存在"的方案：

- `claims?: Partial<PortalJwtClaims>` —— 把"可能不存在"和"字段可能为空"两个概念混在一起，调用方仍要处理两层可选。
- 判别联合 `{ kind: 'gateway' } | { kind: 'verified', claims }` —— 类型上最精确，但**只有 2 个消费者，其中一个读的字段还恒等于 `userId`**。为两个消费者引入判别联合是过度设计（YAGNI）。
- **选定**：只暴露确实被消费的字段。若将来真需要 claims（例如新增需要 `email` 的端点），应是**扩展 `ResolvedIdentity` 的显式字段**，而不是把整个 claims 对象重新打开。

### 4. `tokenInfo` 契约保持不变

`me` 端点的 `tokenInfo.expiresAt` / `issuedAt` 是既有 API 契约（有专门测试 `返回 tokenInfo.expiresAt 用于前端静默刷新调度`），语义不变，仅取值来源由 `claims.exp` 改为 `identity.expiresAt`。

**顺带记录一个观察（本次未改）**：`tokenInfo` 在生产前端代码中**零消费者**，但它是公开 API 契约且有测试，因此不擅自删除。另外，Gateway 信任路径下的时间字段来自 `decodeJwtPayload`（未验签）——不过该 token 已由 Gateway 完成 ES256 验签与 jti 复核，且**过期时间本身不是秘密**（客户端本就持有该 HttpOnly Cookie），因此不构成新的信息披露面。

## 后果

**收益**
- 类型不再说谎：`ResolvedIdentity` 的每个字段在任何路径上都有定义，`expiresAt`/`issuedAt` 用 `null` 显式表达"无法确定"，而不是用 `0` 或 `undefined` 混进 `number`。
- 删除 `EMPTY_CLAIMS` 常量与"下游消费方需自行处理空值"这条散文式不变量。
- `claims` 不再跨越 seam，aud 复核成为 `verify-jwt.ts` 的内部实现细节。
- 顺带修正一处语义错误：`server-logger` 原先把 `claims.sub`（即 userId）写入访问日志的 `username` 字段，现改为写 `userId` 并加注释说明该路径无独立用户名。

**代价**
- `me` 端点的 `tokenInfo` 取值来源变更（行为不变，有测试钉住）。
- 11 个测试夹具中的 `claims: { sub: '', iss: '', aud: 'auth-sso', jti: '' }` 拷贝被删除——这本身也印证了哨兵值在被广泛复制。

**未覆盖**：`PortalJwtClaims` 类型本身保留（`verifyAccessToken` / 签发函数仍需它）；本次只改 Portal 身份边界的**对外形状**。

## 验证

- `tsc` 0 错误——**typecheck 是本次的关键门禁**：它把 `me/route.ts` 那个被 grep 漏掉的 `claims` 消费点暴露出来。
- `pnpm test` 52 文件 / 436 用例全绿（含 `me-endpoints` 的 `tokenInfo.expiresAt` 契约测试）。
- `lint` 0 errors。
- 残留检查：全库 `EMPTY_CLAIMS` 与 `claims: { sub: ''` 命中为 0。

## 相关 ADR

- ADR-005: 三层安全模型（本 ADR 细化 Layer 3 中身份解析的对外形状）
- ADR-006: JWT 最小化（身份数据剥离；本 ADR 把"最小化"落实到 Portal 的边界类型）
- ADR-013: per-client aud（aud 复核语义；本 ADR 把它收为 `verify-jwt.ts` 的内部步骤）
- ADR-014: 数据范围授权门面（`canAccessDept` 曾被迫处理空 aud/jti，现该负担消失）
