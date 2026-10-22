# 研究笔记：OIDC / OAuth 2.1 Provider 实践对照（2026-09-29）

> 研究范围：Portal 作为 OIDC Provider 的端点实现（authorize / token / introspect / revoke / userinfo / discovery / jwks）对照 OAuth 2.1 draft、RFC 9700（安全 BCP）等一手规范来源的差距分析。
> 方法：先完整读取对应源码，再逐条回溯到拥有该事实的规范来源；无法从一手来源验证的说法显式标注"未验证"。

## TL;DR — 最重要的 5 条行动建议

1. **【高风险】token 端点未强制比对 `redirect_uri`**：authorize 端点强制要求 `redirect_uri`（`authorize/route.ts:39`），按 RFC 6749 §4.1.3，token 端点此时必须"REQUIRED"并逐字比对；当前 `token/route.ts:80` 仅在"提供了才比对"（`if (redirect_uri && ...)`）。应改为必填 + 强制相等。
2. **【高风险】discovery 广告 `client_secret_basic` 但未实现**：contracts 广告 `['client_secret_basic', 'client_secret_post', 'none']`（`packages/contracts/src/oidc.ts:18`），但 `parseOAuthBody` 只解析请求体，三个端点从不读取 `Authorization: Basic` header。选择 Basic 的标准 RP 将直接失败。要么实现 Basic 解析，要么收敛广告清单——元数据必须与实际行为一致（OIDC Discovery §4.3 的 issuer 一致性精神同样适用于元数据真实性）。
3. **【高风险】JWKS 密钥轮换零重叠窗口**：新密钥在旧密钥过期**之后**才生成（`signing-keys.ts:107-113` 只取最新一行，过期才生成新对），而 JWKS 端点立即过滤掉过期密钥（`jwks/route.ts:22-29`）。旧密钥过期瞬间，持旧 AT（TTL 1h）的外部 RS 若 JWKS 缓存失效/重启将无法验签。业界共识：旧公钥在 JWKS 中保留 ≥ 最大 token TTL（见 §6）。
4. **【中风险】authorize 响应未携带 RFC 9207 `iss` 参数**：mix-up 攻击防御的推荐对策（RFC 9700 §4.4.2.1 引用 RFC 9207），支持该规范的服务器"MUST"携带。加上后在 discovery 声明 `authorization_response_iss_parameter_supported: true`。
5. **【中风险】userinfo 401 缺 `WWW-Authenticate` header**：RFC 6750 §3 规定受保护资源对无凭证/无效凭证请求"MUST include the HTTP WWW-Authenticate response header field"，`error="invalid_token"` 属性为 SHOULD。

---

## 1. OAuth 2.1 现状

### 规范结论

- OAuth 2.1 尚未成为 RFC：当前为 **draft-ietf-oauth-v2-1-16**（2026-09 发布），仍是 WG Document，工作组计划 **2026-12 提交 IESG**（[datatracker](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1)）。
- 相对 RFC 6749 的核心强制变化（[oauth.net/2.1](https://oauth.net/2.1) 与 draft 正文）：
  - **PKCE 对所有客户端强制**（含机密客户端）；
  - **废除 implicit grant 与 ROPC**（authorization endpoint 不再返回 token）；
  - **redirect_uri 精确字符串匹配**（localhost 原生应用端口例外，RFC 8252 §7.3）；
  - **authorization code 一次性使用** + 重放后撤销（继承 RFC 9700 §4.2.4）；
  - **公开客户端的 refresh token 必须 sender-constrained 或轮换**（继承 RFC 9700 §2.2.2）。

### 本项目现状

- `RESPONSE_TYPES_SUPPORTED = ['code']`、`GRANT_TYPES_SUPPORTED = ['authorization_code', 'refresh_token']`（`packages/contracts/src/oidc.ts:16-17`）——implicit/ROPC 天然不存在。✅
- PKCE 全强制：authorize 端点 `code_challenge` + `code_challenge_method: z.literal('S256')` 为必填（`authorize/route.ts:44-45`）；token 端点要求 `!authCode.codeChallenge || authCode.codeChallengeMethod !== 'S256'` 即拒（`token/route.ts:85-87`）。✅ 已对齐 OAuth 2.1。

### 差距与建议

无结构性差距。注意 `state` 在 authorize 端点为**必填**（`authorize/route.ts:42`），严于 RFC 6749 §4.1.1 的 RECOMMENDED——属"更严格"的合法设计选择，但对不带 state 的标准 RP 是兼容性门槛，建议保留（安全收益）并在接入文档中声明。

## 2. 必读 RFC/规范清单与关键强制点

| 规范 | 与 Provider 验收直接相关的条目 | 本项目出处锚点 |
|------|------------------------------|---------------|
| RFC 6749 §4.1.2 | 授权码有效期上限 10 分钟（RECOMMENDED） | `authorize/route.ts:96`（5min）✅ |
| RFC 6749 §4.1.3 | authorize 携带过 redirect_uri 时，token 端点 redirect_uri REQUIRED 且值必须相同 | ❌ 见 §7 高风险项 |
| RFC 7636 | PKCE S256 语义（SHA256(verifier) base64url 比对） | `oauth-code.ts:52-61` ✅ |
| RFC 9700 §2.5 | "Authorization servers SHOULD enforce client authentication"；推荐非对称方法（mTLS/signed JWT） | token/introspect/revoke 均强制 client 认证 ✅ |
| RFC 9700 §4.2.4 | 授权码首次兑换后 MUST 失效；二次兑换 SHOULD 撤销基于该 code 的全部 token | 原子领取 ✅（`token/route.ts:70-82`），二次兑换撤销未做（低风险） |
| RFC 9700 §4.14 | refresh token 轮换 + 重放检测（token family 语义） | `token.ts:261-337` ✅ 家族撤销 + sender 绑定 |
| RFC 9700 §4.4/§4.4.2.1 | mix-up 防御 REQUIRED（多 AS 场景），首选 RFC 9207 iss 参数 | ❌ 见 §7 |
| RFC 7662 | introspection 请求必须认证（§2.1）；未知 token 返回 `{active:false}` 不报错（§2.2） | `introspect/route.ts` ✅ |
| RFC 7009 | revocation 请求必须认证（§2.1）；恒返 200（§2.2）；撤 RT 时 SHOULD 级联撤同 grant 的 AT | 恒 200 ✅；级联 ❌ 见 §7 |
| RFC 6750 §3 | 受保护资源 401 时 MUST 带 `WWW-Authenticate: Bearer ...`；invalid_token 属性 SHOULD | ❌ userinfo 缺失 |
| RFC 9207 | 授权响应携带 `iss` 参数（支持该规范的服务器 MUST）；元数据 `authorization_response_iss_parameter_supported` | ❌ 未实现 |
| OIDC Discovery §4.3 | issuer MUST 与 discovery URL 前缀完全一致，且等于 ID Token 的 iss | ✅（`openid-configuration/route.ts:29`，历史 'auth-sso' 非 URL 问题已按 ADR-012 修复） |

> 标注：RFC 7636 / 7662 / 8414 三项本次未逐字核对全文，结论依据 RFC 9700 引用链与代码内既有注释交叉验证，见文末"未验证条目"。

## 3. token 端点实践

### 规范结论

- **client 认证**：RFC 9700 §2.5——"Authorization servers SHOULD enforce client authentication if it is feasible"；"It is RECOMMENDED to use asymmetric cryptography for client authentication, such as mutual TLS [RFC8705] or signed JWTs"。
- **refresh token 轮换**：RFC 9700 §4.14.2——"MUST utilize one of these methods to detect refresh token replay by malicious actors for public clients"；轮换后旧 RT 重放即泄露信号，撤销该授权关系下的活跃 token。
- **redirect_uri**：RFC 6749 §4.1.3——"REQUIRED, if the redirect_uri parameter was included in the authorization request"，"their values MUST be identical"。

### 本项目现状（代码事实）

- client 认证：`client_id` 必填 + `validateClientSecret`（`oauth-client.ts:47-72`）——bcrypt 与 SHA-256 双轨均走定时安全比较（`bcrypt.compare` / `timingSafeEqual`）✅；`isPublic` 客户端无 secret 放行（`oauth-client.ts:51-53`），对应广告中的 `none`。
- 凭证只从请求体读取（`parseOAuthBody`，`oauth-body.ts:19-45`），**从不读 `Authorization` header**。
- RT 轮换：`rotateRefreshToken`（`token.ts:261-337`）在 `db.transaction` + `FOR UPDATE` 行锁下完成——重放检测（revoked 命中 → 撤销同 `(userId, clientId)` 家族）、sender 绑定（client 不匹配视同泄露、家族撤销）、新 RT 入库、旧 RT 标记撤销。与 RFC 9700 §4.14 语义对齐，且通过限定撤销范围消除了跨 client DoS 放大。✅
- 授权码原子领取：`UPDATE ... WHERE used=false AND expiresAt>now RETURNING`（`token/route.ts:70-82`）——并发下仅一个请求成功，PKCE 失败后 code 同样保持已消费（防离线穷举 verifier）。✅
- `token/route.ts:91` 的第二次 `set({ used: true })` 为冗余代码——领取 SQL 已置位，属清理项（非缺陷）。
- RT 无条件发放：code 兑换总是 `issueRefreshToken`（`token/route.ts:104`），即使 client 未请求 `offline_access`。

### 差距与建议

1. **【高】补 `redirect_uri` 强制比对**：token schema 中 `redirect_uri` 改为必填（authorize 已必填），比对逻辑去掉 `if (redirect_uri && ...)` 前置条件。
2. **【高】`client_secret_basic` 二选一**：实现 `Authorization: Basic base64(client_id:client_secret)` 解析（注意 RFC 6749 §2.3.1 的 application/x-www-form-urlencoded 编码规则），或从 `TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED` 移除 `client_secret_basic`。推荐实现——主流 RP 库默认发 Basic。
3. **【中】introspect 注释与实现不一致**：`introspect/route.ts:52-53` 注释称"AT 经 ADR-006 最小化后不含 scope/client_id 语义"，但 `signAccessToken` 实际写入了 `scope` claim（`token.ts:78`）。建议 introspect 对 AT 透传 `claims.scope` 给 RS（RFC 7662 §2.2 的 `scope` 字段本就是为 RS 设计），并修正注释。
4. **【低】`offline_access` 语义**：OIDC Core §11 要求 RT 仅在明确请求 `offline_access` 且用户同意时发放。当前无条件发放可作为 AS 自由裁量，但会放大 RT 暴露面，建议按 scope 判定。
5. **【低】RFC 9700 §4.2.4 二次兑换撤销**：code 重放（第二次兑换同一 code）目前仅拒绝、不撤销首次兑换签发的 token，可接受但可加固。

## 4. Sender-constrained tokens（DPoP / mTLS）

### 规范结论

- **DPoP**：RFC 9449，2023-09 发布（[rfc-editor](https://www.rfc-editor.org/rfc/rfc9449)）——应用层 PoP，客户端用临时密钥对签名 proof，AT 绑定 `cnf.jkt`（JWK thumbprint）。RFC 9700 将其列为 sender-constraining 的推荐应用层机制之一。
- **mTLS**：RFC 8705——传输层证书绑定，适合内部高信任部署。
- RFC 9700 §2.2.2：公开客户端的 RT "MUST be sender-constrained or use refresh token rotation"。

### 本项目现状

- 未实现 DPoP/mTLS；公开客户端 RT 走轮换 + 家族撤销（`token.ts:261-337`），满足 RFC 9700 §2.2.2 的二选一要求。✅

### 差距与建议

**当前规模不建议引入 DPoP**，理由：
- DPoP 的 proof 防重放（`iat`/`jti` 窗口跟踪）需要服务端状态；本架构 Gateway 端为离线验签 + Redis fail-close（ADR-004），DPoP 校验落在 Gateway 可行但增加每请求 Redis 交互与密钥面。
- 触发条件建议：第三方 RS 上量、或对标 FAPI 2.0 认证时再评估（ADR-006 分层备忘中"OAuth 协议数据按 ADR-012 决策 4 演进"已为此留口）。

## 5. ID Token / UserInfo

### 规范结论

- OIDC Core §2：ID Token 必含 `iss`/`sub`/`aud`/`exp`/`iat`；`nonce`（§3.1.2.1）仅在授权请求携带时写入；`azp` 仅多 aud 时 REQUIRED；`at_hash` 在 code flow 中非必需（implicit/hybrid 才 REQUIRED）。
- OIDC Core §5.1：userinfo claims 按 scope 释放（`profile` → name/preferred_username/picture 等；`email` → email/email_verified）。
- RFC 6750 §3：userinfo 作为受保护资源，401 时 MUST 带 `WWW-Authenticate`。

### 本项目现状（代码事实）

- `signIdToken`（`token.ts:174-201`）：`iss`/`sub`/`aud=clientId`/`exp`/`iat`/`auth_time`（取 authorization_codes.createdAt）/`nonce` 条件写入，另有 `jti`。✅ 必含 claims 齐全；单 aud 故无 `azp` 正确。
- userinfo 按 scope 释放 claims（`userinfo/route.ts:40-50`），`sub` 恒返回。✅
- `audience: null` 跳过 aud 校验（`userinfo/route.ts:29`，注释"多 client 通用端点"）；token 来源支持 Cookie 回退（`userinfo/route.ts:20-23`）。

### 差距与建议

1. **【中】401 缺 `WWW-Authenticate: Bearer error="invalid_token"`**（RFC 6750 §3 MUST/SHOULD）——补 header 即可，改动一行。
2. **【标注】Cookie 回退取 token** 是面向门户自身的非标准扩展；对第三方 RS 语义上等价于同时支持两种凭证通道。建议保持但文档化（discovery 自定义字段同款处理）。
3. **【标注】`aud` 体系级设计**：AT 的 `aud` 恒为 `PORTAL_AUD = 'auth-sso'`（`oidc.ts:7`、`token.ts:82`），非 per-client。任何 RS 均可接受任何 client 换来的 token（token 替代风险）。这是 ADR-006 的有意决策 + ADR-006"分层备忘"明确留给 ADR-012 决策 4 的演进路径，非遗漏——**第三方 RS 上量前必须演进为 per-client aud**。

## 6. JWKS / 密钥轮换

### 规范/实践结论

- RFC 7517 定义 JWKS 格式与 `kid`/`use`/`alg` 语义，但未规定轮换窗口；**业界共识做法**（多厂商一致）：先发布新公钥 → 用新 kid 签发 → **旧公钥保留至所有以其签发的 token 过期** → 再移除；提前移除会使存量 token 验签失败（[BlitzWare JWT 最佳实践](https://blitzware.xyz)、[MojoAuth JWK 端点解析](https://mojoauth.com)、[WorkOS RFC 9700 解读](https://workos.com/blog/oauth-best-practices-rfc-9700)）。
- `draft-ietf-oauth-jwks-expiration`（JWKS 密钥过期元数据）试图将轮换标准化，**本次未能确认其 RFC 状态，标注未验证**。

### 本项目现状（代码事实）

- 密钥 90 天有效期，进程内缓存 5 分钟、按 `kid` 索引多 key 共存（`signing-keys.ts:26-49`）。
- `getActiveSigningKey` 只取 jwks 表**最新一行**，仅当其过期才生成新密钥对（`signing-keys.ts:107-146`）——即**新密钥生成时旧密钥已过期**。
- JWKS 端点只返回 `expiresAt > now` 或 NULL 的密钥（`jwks/route.ts:22-29`），注释明确"避免暴露历史密钥"。
- Portal 自身验签按 `kid` 查 DB（`getSigningKeyByKid`，`signing-keys.ts:70-93`），**不筛过期**——Portal 内部不受影响；受影响的只有通过 JWKS 拿公钥的外部验签方（Gateway 冷启动/缓存过期）。

### 差距与建议

**【高】轮换零重叠窗口**：90 天密钥过期瞬间，JWKS 立即丢失旧 `kid`，而此后 1 小时内仍有以其签发的存量 AT（TTL 1h，`token.ts:62`）。此时 Gateway 若发生 JWKS 缓存失效或重启（ADR-005 离线验签架构下 Gateway 无 DB 访问能力），kid 未命中 → 验签失败 → 存量用户被迫重登。建议：JWKS 查询窗口改为 `expiresAt > now - GRACE`（GRACE ≥ max(AT_TTL, ID_TOKEN_TTL) + 时钟偏移，如 2h）；签名选钥逻辑不变。

## 7. 六端点差距对照（汇总）

| 端点 | 现状要点 | 规范要求 | 差距/风险 | 等级 |
|------|---------|---------|----------|------|
| authorize | PKCE S256 强制、redirect 精确白名单（`oauth-client.ts:85-89`）、code 5min、state 必填、Redis 暂存参数 GETDEL 原子消费 | RFC 7636/9700 §2.1/§4.1.2 | `iss` 参数缺失（RFC 9207） | 中 |
| token | 原子领码、PKCE 强制、RT 轮换+家族撤销+sender 绑定、定时安全比较 | RFC 6749 §4.1.3 / RFC 9700 §2.5/§4.14 | ① redirect_uri 未强制比对；② 广告 basic 未实现；③ introspect 注释与 scope 实情不符 | 高/高/中 |
| introspect | client 认证 ✅、未知 token `{active:false}` ✅、AT/RT 双探测 | RFC 7662 §2.1/§2.2 | AT 响应可透传 `scope` | 低 |
| revoke | client 认证 ✅、恒 200 ✅、hint 语义 ✅ | RFC 7009 §2.1 | 撤 RT 未级联撤同 grant 的 AT（SHOULD） | 中低 |
| userinfo | scope 门槛释放 claims、sub 恒返 | RFC 6750 §3 / OIDC Core §5.1 | 401 缺 `WWW-Authenticate`；Cookie 回退需文档化 | 中 |
| discovery | issuer 已 URL 化（ADR-012）、end_session_endpoint、自定义字段 2 个 | OIDC Discovery §4.3/§3 | 广告与实现一致性（basic）；自定义字段建议 `x-` 前缀命名惯例 | 高/低 |
| jwks | `kid`/`use`/`alg` 完整、`connection()` 防 Next 静态化、冷启动自举 | RFC 7517 | 轮换零重叠窗口 | 高 |

**已知且已被接受的取舍**（非差距，记录在案）：AT `aud` 体系级（ADR-006）；Redis fail-close（ADR-004 2026-09-28 修订）；`access_tokens` 表已删除（ADR-004）。

## 8. 前瞻

- **OAuth 2.1**：2026-12 提交 IESG（[datatracker 里程碑](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1)），RFC 化后按 §2.1.1/§4 逐条复核（本项目当前已大体对齐，复核成本低）。
- **FAPI 2.0 Security Profile**：2024 年起为 OpenID Final Specification，ETSI EN 319 432 已引用（[self-issued.info](https://self-issued.info) 等二手来源，状态以 openid.net 为准）——信创高安全场景可将其作为 Provider 硬化路线图（其核心要求：PKCE + sender-constrained + 精确 redirect + 加密响应，多数本项目已具备）。
- **OpenID Federation 1.x**：跨组织信任链规范，2025-2026 持续推进——对跨部门 SSO 场景有中期价值，观察即可。
- **DPoP**：生态采用渐进中，触发条件见 §4。

## 未验证条目

1. `draft-ietf-oauth-jwks-expiration` 的当前状态（两次检索均超时/无果）。
2. RFC 7636、RFC 7662、RFC 8414 未逐字核对全文；结论经 RFC 9700 引用链、代码内注释与通用规范知识交叉验证。
3. OIDC Core §11（offline_access）与 §5.1 的条文细节未逐字核对原文。
4. FAPI 2.0 / OpenID Federation / ETSI 引用状态来自二手来源（self-issued.info、厂商发布说明），未查 openid.net 原始公告页。

## 参考来源（访问日期：2026-09-29）

- OAuth 2.1 draft：https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1 ；https://oauth.net/2.1
- RFC 9700（OAuth 2.0 Security BCP, BCP 240, 2025-01）：https://www.rfc-editor.org/rfc/rfc9700.html
- RFC 6749：https://www.rfc-editor.org/rfc/rfc6749.html
- RFC 6750：https://www.rfc-editor.org/rfc/rfc6750.html
- RFC 7009：https://www.rfc-editor.org/rfc/rfc7009.html
- RFC 9207：https://www.rfc-editor.org/rfc/rfc9207.html
- RFC 9449（DPoP, 2023-09）：https://www.rfc-editor.org/rfc/rfc9449
- RFC 8705（mTLS）：https://www.rfc-editor.org/rfc/rfc8705
- OpenID Connect Discovery 1.0：https://openid.net/specs/openid-connect-discovery-1_0.html
- JWKS 轮换实践（社区多源一致）：https://blitzware.xyz ；https://mojoauth.com ；https://workos.com/blog/oauth-best-practices-rfc-9700
- OpenID 规范动态（Mike Jones 博客）：https://self-issued.info
- 本仓库依据：AGENTS.md、docs/adr/ADR-004、docs/adr/ADR-006、apps/portal/src/{app,domain,lib}/ 相关源码（file:line 见正文）
