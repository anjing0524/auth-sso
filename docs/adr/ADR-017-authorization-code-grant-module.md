# ADR-017: 授权码兑换收敛为深 module —— 失败按安全语义可判别

| 属性       | 值                                                                    |
|------------|-----------------------------------------------------------------------|
| **状态**   | implemented (2026-10-08)                                              |
| **日期**   | 2026-10-08                                                            |
| **决策者** | Auth-SSO 团队（improve-codebase-architecture 架构评审候选 ⑤）          |
| **影响范围** | `lib/auth/oauth-grant.ts`（新增）、`app/api/auth/oauth2/token/route.ts`、`domain/auth/types.ts`（新增 `OAuthTokenResponse`） |

## 背景

`authorization_code` 授权类型的整条编排原先活在 token 路由的 `POST` 里（106 行，单一函数）：Zod 门禁、client 凭证认证、**原子领取授权码的裸 SQL**、**重放取证的第二条裸 SQL**、PKCE 校验、权限上下文读取与预填充、条件签发 AT/RT/ID Token、以及 OAuth 错误形状的手写拼装。

同目录的 `rotateRefreshToken`（`lib/auth/token.ts`）已经是"深 module"的好样板：接口小（`(oldRT, expectedClientId?) → RefreshTokenResult | null`），后面藏着事务、行锁、家族撤销、sender 绑定与补偿回收。**同一个 grant 家族里，refresh_token 走深 module，authorization_code 走路由内联**——这是形状不一致，而非取舍。

**测试面的代价最能说明问题**：`oauth2-token.test.ts` 需要 mock **六个** module（`@/infrastructure/db`、`@/lib/auth/token`、`@/lib/permissions`、`@/lib/audit`…）**外加真实 PostgreSQL**，才敢测一个 400 响应。真正的复杂度（领取的原子性、重放判定、PKCE 顺序）没有任何直接被断言的目标。

## 决策

### 1. 抽取 `exchangeAuthorizationCode`，路由退化为协议适配

```
POST /token  →  Zod 门禁 → 凭证认证 → 分派 grant → 写响应
                                        ├─ authorization_code → exchangeAuthorizationCode()   [本 ADR]
                                        └─ refresh_token      → rotateRefreshToken()            [既有样板]
```

模块内收拢：原子领取、重放识别与家族撤销、PKCE、权限上下文预填充、条件签发。**路由不再出现裸 SQL 与签发序列**。

### 2. 失败按**安全语义**可判别，而不是压成 `null`

```ts
export type AuthorizationCodeExchangeResult =
  | { readonly ok: true;  readonly tokens: OAuthTokenResponse }
  | { readonly ok: false; readonly reason: 'authorization_code_replayed' }
  | { readonly ok: false; readonly reason: 'invalid_grant'; readonly detail: string };
```

先考虑过沿用 `rotateRefreshToken` 的 `Promise<Result | null>`，但被否决：**授权码重放是安全事件，不只是响应形状**（RFC 9700 §4.2.4 的"疑似泄露"信号），调用方必须为它留审计痕迹。把两种失败压成同形 `null` 会丢掉"为何失败"，而路由仍需据此决定是否写 `LoginLog`。

同时决定**不在模块内直接写审计日志**（尽管 Gateway 的 `oauth_flow.rs` 有 `warn!` 先例）：日志写入会引入 `writeLoginLog` + HTTP 元数据依赖，使测试不得不 mock 它才能断言失败原因。返回判别式联合让**失败原因本身成为可断言对象**——`oauth-grant.test.ts` 因此可以断言 `reason === 'authorization_code_replayed'` 而完全不碰日志 mock。

HTTP 元数据（IP / UA）与日志写入留在路由：它们属于表现层，模块不应知道 HTTP 存在。

### 3. client 参数收窄为 `{ clientId }`

```ts
readonly client: { readonly clientId: string };
```

模块不需要 client 的其余字段；而**家族撤销锚点刻意取自授权码行**（`authCode.userId` + `authCode.clientId`），不用调用方传入的 client——调用方传错就撤错家族。窄接口让这个意图在签名上可见。

### 4. 撤销原语经 `./token` 模块边界导入，不直连 `./token/revocation`

`token.ts` 是 token 族的模块边界（re-export 撤销原语）。直连内部文件会绕过这个边界——实测后果是测试对 `@/lib/auth/token` 的 mock 失效（重放用例失败）。**从模块边界导入**同时满足架构意图与可测性。

## 后果

**收益**
- 路由从 106 行编排降为协议适配；两种 grant 形状一致（都委托深 module）。
- 真正的复杂度有了可断言的 seam：`oauth-grant.test.ts` 10 例直接测 interface，**不需要 HTTP 请求**，也不需要 mock 六个 module。
- 两条**原先只写在注释里、零覆盖**的不变量现在被测试钉住：
  - "PKCE 失败后授权码同样保持已消费"（防离线穷举 verifier）
  - "过期未消费的授权码不触发家族撤销"（防随机 code 的 DoS 放大）
- 失败原因成为类型的一部分，调用方无法"忘记"处理重放这一安全事件。

**代价**
- `OAuthTokenResponse` 是新增类型（放在 `domain/auth/types.ts`）。
- 路由少了一个 `ACCESS_TOKEN_TTL` 导入（`expires_in` 现由 module 产出）——由 lint 捕获为孤儿。
- 抽出后 `oauth2-token.test.ts` 的 12 例与新的 10 例存在**部分重叠**（前者走 HTTP 全链路，后者直测 interface）。这是有意的：前者守护协议契约（错误形状、状态码），后者守护编排语义（判别式失败、签发门控）。

**未覆盖**：`validateAuthCodeRow`（`domain/auth/auth-code.ts`）仍是"位置错了的 module"——它有 5 个单测但**生产零调用**，真实判定住在 SQL 的 WHERE 子句里。本次把该 SQL 收进了 module，但没有删除这个失去意义的纯函数。**删除它是独立决策**（需同步删其测试），挂号待办。

## 增补（2026-10-23）：授权码兑换的校验顺序 —— `redirect_uri` 并入原子领取（H-06 / 决策 D13）

**背景**：原实现先执行原子领取（条件 UPDATE 置 `used=true`），**之后**才比对 `redirect_uri`。
后果有两层（审计 H-06 实测）：

1. 持有 client 凭证者可用"正确 code + 错误 redirect_uri"使合法授权码作废（合法 RP 随后兑换
   只能得到 `invalid_grant`）；
2. 合法 RP 用错误参数重试后，再用正确参数重试会被判为「授权码重放」，进而**撤销整个家族
   的 Refresh Token**——把一次参数错误放大成一次会话事故。

**决策：`redirect_uri` 与 `code` / `clientId` / `used=false` / `expires_at > now()` 一起进
原子领取的 `WHERE`；领取失败后仍按原有逻辑区分「重放」与「无效 grant」。**

- 实现：`lib/auth/oauth-grant.ts:78` 起 `claimAuthorizationCode(code, clientId, redirectUri)`，
  `:93` 的 `eq(authorizationCodes.redirectUri, redirectUri)`；
- 语义：错误 redirect 的请求**领不到**行（`used` 保持 false），因此
  - 合法 RP 用正确参数重试仍可成功；
  - 不会被误判为"授权码重放"而触发家族撤销；
- 与"PKCE 失败后 code 仍保持已消费"的关系（**刻意保留的差异，如实记录**）：
  - `redirect_uri` 校验在领取前（不消耗 code）——它可由 `clientId` + 注册白名单在协议层确定，
    不消耗 code 不产生暴力猜测面；
  - **PKCE 校验仍在领取之后**：校验失败时 code 保持已消费。这是本文原决策的一部分
    （"PKCE 失败后授权码同样保持已消费"，防止攻击者拿到有效 code 离线穷举 `code_verifier`）。
  - 因此决策 D13 原文"redirect_uri/PKCE 校验前置于 used 置位"中，**PKCE 一项未按字面落地**；
    这是与决策文本的差异，需 Lead 裁决：若确认要"PKCE 失败也不消耗 code"，会重新打开
    `verifier` 离线穷举面，不建议；当前实现取"redirect 前置 + PKCE 保持消费"。
- 回归：`oauth-grant.test.ts` 新增用例（错误 redirect 不消耗 code、正确重试成功、重放仍触发
  家族撤销），见 `.zcode/audit/auth.md` §H-06 与修复批次 F2。

## 验证

- `tsc` 0 错误。
- `pnpm test` 53 文件 / 446 用例全绿（新增 `oauth-grant.test.ts` 10 例）。
- `oauth2-token.test.ts` 12 例全绿——证明抽出后**协议行为逐位保持**。
- `lint` 0 errors（76 warnings，比基线少 1）。
- 2026-10-23 增补的 redirect_uri 顺序修复：`oauth-grant.test.ts` 新增用例先红后绿
  （修复批次 F2 记录），且重放家族撤销的原有用例保持绿。

## 相关 ADR

- ADR-016: 身份边界形状（同一纪律：让失败/缺失**可判别**而非压成哨兵）
- ADR-013: per-client aud（AT 的 `aud`/`client_id` 取值来自授权对象 client）
- ADR-012: RT 绑定 client（家族撤销锚点 `(userId, clientId)` 的语义来源）
- ADR-011: 故障语义分级（权限上下文预填充失败按缓存性数据 fail-open 处理）
