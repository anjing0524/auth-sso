# ADR-023: 登录会话与授权请求的绑定 —— 拒绝「授权请求注入」（login CSRF）

| 属性       | 值                                                                    |
|------------|-----------------------------------------------------------------------|
| **状态**   | accepted / implemented (2026-10-23)                                   |
| **日期**   | 2026-10-23                                                            |
| **决策者** | Auth-SSO 团队（安全审计批次 D1–D17，决策 D12）                          |
| **影响范围** | `login_session` JWT claims、`/api/auth/login`、`/api/auth/oauth2/authorize`、`lib/session/auth-request-store.ts`、登出 Cookie 清理、`REQUIREMENTS_MATRIX` H-AUTH-010 |
| **取代**   | 无（补齐实现，不改变 OAuth 授权码流程的形状）                            |

## 背景

OAuth 2.1 授权码流程的「已登录直签发」分支（authorize 分支 B → 登录 → 回跳分支 A）原先只做了
**单向**校验：登录端点看到请求里有 `session_id` 就把它写回跳地址；authorize 分支 A 只验证
`login_session` 的签名与 `sub`，不检查这份登录凭证**是否属于本次授权请求**。

于是存在一类**授权请求注入 / login CSRF**：

1. 攻击者先在浏览器（或脚本）里发起一次 authorize 请求，得到 `session_id=S` 与暂存在
   Redis 的授权参数（攻击者的 `client_id/redirect_uri`，但这些都必须是已注册值）；
2. 攻击者把 `/login?session_id=S` 链接发给受害者；
3. 受害者在自己的浏览器里输入自己的账号密码登录 —— 登录端点按 `session_id=S` 回跳；
4. authorize 分支 A 用**受害者的** `sub` 为**攻击者发起的**授权请求签发授权码，并投递到
   攻击者的 `redirect_uri`（授权码最终被攻击者一方换取为受害者的令牌）。

根因不是某个校验写错，而是 interface 缺少一条不变量：**`login_session` 必须绑定到它要完成的
那个授权请求**。这与 ADR-016「接口必须在类型/字段上表达不变量，而不是靠调用方自觉」同源。

## 决策

**`login_session` 与授权请求 `session_id` 双向绑定；未绑定/不匹配一律拒绝发码。**

实现分三层（全部 fail-closed，缺一不可）：

### 1. 授权请求侧：一次性浏览器绑定 Cookie

authorize 分支 B（未登录）在把参数写入 Redis 时生成 128 bit 随机 `binding`：

- 写入 Redis 暂存对象 `StoredAuthRequest.binding`（TTL 5 分钟）；
- 同时下发 HttpOnly Cookie `oauth_request_binding`（`Path=/api/auth`、`SameSite=Lax`、
  生产 `Secure`、`Max-Age=300`）。

`Path=/api/auth` 是刻意选择：`/api/auth/login`（POST）与 `/api/auth/oauth2/authorize`（GET）
都会携带它，而页面/其它路径不会；HttpOnly 使跨站脚本无法读取或伪造。

实现：`apps/portal/src/lib/session/auth-request-store.ts:35`
（`AUTH_REQUEST_BINDING_COOKIE`）、`:41`（`generateAuthRequestBinding`）。
下发/清除：`app/api/auth/oauth2/authorize/route.ts:303,307`（分支 B）、`:149`（授权完成即清除）。

### 2. 登录侧：绑定校验通过才把 `session_id` 写进 `login_session`

`POST /api/auth/login` 在签发前执行 `resolveBoundSessionId()`：

- 请求携带 `session_id` 但**没有**绑定 Cookie / Cookie 与 Redis 暂存值不一致 / 暂存不存在 /
  Redis 故障 ⇒ **忽略 `session_id`**，按普通登录处理（不进入 OAuth 回跳，也不阻断正常登录）；
- 全部一致 ⇒ 签发 `login_session` 时写入 `sid` claim（= 本次 `session_id`）。

实现：`app/api/auth/login/route.ts:47`（`resolveBoundSessionId`）、`:138`（调用）、`:141`
（`signLoginSession(user.id, boundSessionId)`）；`lib/auth/token.ts:52`（`signLoginSession`
的 `sid` claim）；`domain/auth/types.ts`（`PortalJwtClaims.sid?: string`，仅 LoginSession 携带）。

### 3. 授权侧：三道检查全过才发码（顺序有意义）

authorize 分支 A 在**消费** Redis 暂存参数（`GETDEL`）之前完成：

1. `login_session` 验签通过（既有）；
2. `login_session.sid === URL 里的 session_id`（否则 `session_expired`）；
3. 浏览器绑定 Cookie 存在（否则 `session_expired`）；
4. `GETDEL` 之后再次核对 `stored.binding === Cookie 值`（否则 `session_expired`）。

第 2/3 步放在 `GETDEL` 之前是刻意的：**被注入的请求不应消耗真正的授权请求**（否则受害者
重试会得到 `session_expired`，把一次攻击放大成一次可用性故障）。第 4 步防御 Redis 内容被
替换/旧格式数据（旧暂存对象没有 `binding` 字段，无法通过校验，需重新发起授权）。

实现：`app/api/auth/oauth2/authorize/route.ts:187`（sid）、`:198`（Cookie 存在性）、
`:215`（binding 二次核对）。

### 4. 登出与失败路径的 Cookie 生命周期

- 登出清理 `login_session` 时一并清除 `oauth_request_binding`（`app/api/auth/logout/route.ts`）；
- authorize 分支 B 重新发起授权会覆盖绑定 Cookie（同 Path）；
- 绑定不对用户可见、不写日志正文（只记 `hasBindingCookie/hasStoredRequest` 布尔）。

### 5. 已知边界：同一浏览器多标签并发授权

绑定值存放在**浏览器级** Cookie（`oauth_request_binding`，同 Path）与 Redis 暂存值中，
因此同一浏览器**同时发起两个授权请求**时，后发起的分支 B 会覆盖绑定 Cookie：

- 先发起标签的登录会因绑定不匹配而降级为**普通登录**（不报错、也不回跳该标签的目标应用），
  用户需要在那一个标签重新发起登录；
- 安全上仍是 fail-closed（不会把身份导向错误 client），只影响并发体验；
- 若要支持并发，可把绑定改为 `Map<session_id, binding>`（Redis 已按 `session_id` 分键）
  或在 Cookie 名中携带 `session_id`；需评估 Cookie 数量/清理路径成本，暂列 backlog。

### 6. 分支 B 的边界：已登录用户零交互发码是**有意的 SSO 行为**

本 ADR 修复的是「**攻击者构造授权请求 → 诱导受害者登录**」这条注入链（分支 A 路径）：
login_session 必须带 `sid` 且与浏览器绑定 Cookie 一致，否则不回跳。

**未改变**：已登录用户（浏览器持有有效会话）访问任一受保护页面时，Gateway 以其统一 OAuth Client
发起 authorize，Portal 分支 B 会**零交互**直接签发授权码（不再要求确认）。这是 SSO 的预期体验
（否则每次跨子应用都弹确认），且当前风险面受以下约束收敛：

- Gateway 是**唯一** OAuth Client（ADR-010），`client_id`/`redirect_uri` 来自服务端配置而非用户输入；
- 授权请求的 `state`/`nonce`/PKCE 由 Gateway 生成并与浏览器 Cookie 绑定，攻击者无法预置；
- 因此"第三方页面让受害者浏览器发起一个走向攻击者 client 的授权请求"不成立（不存在这样的 client）。

若未来引入**多 OAuth Client**（外部 RP 直连），分支 B 必须补显式确认页（consent）或把
`client_id` 纳入 login_session 绑定，否则该边界会失效。此处记录为 ADR-010 演进的前置条件。

## 后果

**收益**

- 关闭「登录会话被跨授权请求复用」的注入面：攻击者无法把受害者登录导向自己发起的
  client/redirect（即使该 client 是合法注册的）。
- 不变量落在**字段与校验序列**上，而不是注释里：`sid` 缺失/不匹配在类型上可判别，
  绑定 Cookie 缺失在 authorize 侧直接拒绝。
- 兼容性：普通登录（无 `session_id`）不携带 `sid`，既有链路零变化；Redis 故障时退化为
  普通登录（安全降级为"不进 OAuth 回跳"，不是放行注入）。

**代价**

- 新增一个 Portal 内部 Cookie（`oauth_request_binding`）。名称唯一真相源已收敛到
  `packages/contracts` 的 `COOKIE_NAMES.AUTH_REQUEST_BINDING`（2026-10-23 修复批次补齐），
  `auth-request-store.ts` 只做别名导出，不再存在第二处字面量。
- authorize 分支 A 多一次 Redis 读取（`peekStoredAuthRequest`）用于 login 侧校验；
  authorize 侧仍只 `GETDEL` 一次，无额外往返。
- 旧格式暂存数据（无 `binding`）会让进行中的授权返回 `session_expired`；因为 TTL 只有 5 分钟，
  发布窗口影响可忽略（无生产存量会话）。

## 验证

| 断言 | 证据 |
|---|---|
| 缺少绑定 Cookie → 登录不进入 OAuth 回跳（核心防线） | `apps/portal/__tests__/api/auth-login.test.ts:258` |
| 绑定 Cookie 不匹配 → 不进入 OAuth 回跳 | `auth-login.test.ts:273` |
| 绑定匹配 → 回跳 authorize，且 `login_session` 携带 sid | `auth-login.test.ts:285` |
| 无 `session_id` 的普通登录不带 sid（不改变既有链路） | `auth-login.test.ts:308` |
| 绑定 Cookie/sid 匹配 → 签发 code 并 302 | `apps/portal/__tests__/api/oauth2-authorize.test.ts:290` |
| 缺绑定 Cookie → 拒绝发码且**不消费**暂存授权请求 | `oauth2-authorize.test.ts:304` |
| 绑定 Cookie 不匹配 → 拒绝发码 | `oauth2-authorize.test.ts:315` |
| `login_session.sid` 与 URL 不匹配 → 拒绝发码且不消费 | `oauth2-authorize.test.ts:327` |

审计证据（独立复现授权请求注入 PoC）：`.zcode/audit/auth.md` §H-02 与
`.zcode/audit/auth/evidence/phase2.json`。

## 相关 ADR

- ADR-003 / ADR-010：Gateway 统一 OAuth Client（登录链路的调用方与回跳路径）
- ADR-012：OIDC 协议合规（`login_session` 的 aud/typ 语义；本 ADR 只新增 `sid` 绑定）
- ADR-016：身份边界形状（同一纪律：把不变量放进字段而不是注释）
- ADR-017：授权码兑换失败可判别（同一纪律：失败原因可断言）
