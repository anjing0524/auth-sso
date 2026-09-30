# 研究问题修复实施规划（OIDC Provider + Pingora Gateway）

**版本**: v1.1
**状态**: Phase 1–3 已实施（2026-09-30），D1/D3 已按推荐方案执行，见文末"决策项执行记录"
**日期**: 2026-09-29
**来源**: [OIDC/OAuth 2.1 研究笔记](../research/2026-09-29-oidc-oauth2-provider-practices.md)、[Pingora/Rust 网关研究笔记](../research/2026-09-29-pingora-rust-gateway-practices.md)

> 本规划对两份研究笔记发现的全部问题逐项深挖验证（含同类问题审阅），拆解出解法与兼容性证据，并给出分阶段实施顺序。每个问题条目含：深挖结论 → 解法 → 触达文件 → 验证方式 → 处置（修复/决策/记录偏差）。

---

## 1. 深挖验证结论（实施前补充取证）

规划前对每个发现做了代码级复核，三处结论被**加强**，一处发现**同类新问题**：

| 深挖动作 | 结论 |
|---------|------|
| 全库 grep `Basic`/`authorization` 头解析（portal） | **坐实** F2：`client_secret_basic` 零实现，token/introspect/revoke 三端点均只读 body 凭证 |
| 检查全部内部 token 交换客户端的 `redirect_uri` | **解阻** F1：Gateway `build_token_exchange_body`（oauth.rs:308-323）✅ 携带；Portal 自身 callback（callback/route.ts:87）✅ 携带；demo-app 无直接交换。**改为必填对已知客户端零破坏** |
| 检查 Portal 是否有定时密钥轮换任务 | **坐实** F3：轮换仅在 `getActiveSigningKey` 惰性触发，无 cron——新密钥生成时旧密钥必然已过期，零重叠坐实 |
| Gateway authorize 请求 scope | **解阻** F14：`oauth_flow.rs:51` 已请求 `offline_access`——RT 按需发放不破坏 Gateway 流程 |
| 审阅 authorize 错误分支（同类问题） | **新发现** F15：`buildOAuthErrorRedirect` 跳 Portal 自有 `/oauth/error` 页面，而非按 RFC 6749 §4.1.2.1 SHOULD 重定向回 client 的 redirect_uri（error+state）——列入决策项 D1 |
| Gateway `respond_401` | 已带 `WWW-Authenticate: Bearer`（http.rs:135-139），同类检查通过，Portal userinfo 是唯一缺失点 |

---

## 2. 问题总表与处置（覆盖研究笔记全部发现）

| # | 问题 | 出处 | 处置 | 阶段 |
|---|------|------|------|------|
| F1 | token 端点 redirect_uri 未强制比对 | OIDC §3/§7 | **修复** | P1 |
| F2 | discovery 广告 client_secret_basic 未实现 | OIDC §3/§7 | **修复** | P1 |
| F3 | JWKS 轮换零重叠窗口 | OIDC §6 | **修复** | P1 |
| F4 | userinfo 401 缺 WWW-Authenticate | OIDC §5/§7 | **修复** | P1 |
| F5 | authorize 响应缺 RFC 9207 iss | OIDC §7 | **修复** | P2 |
| F6 | introspect 注释与 scope 实情不符 | OIDC §3 | **修复** | P2 |
| F7 | RFC 9700 §4.2.4 code 重放后撤销未做 | OIDC §3 | **修复** | P2 |
| F8 | Gateway 上游无健康检查 | GW §4 | **修复**（先 spike） | P2 |
| F9 | revoke 撤 RT 未级联撤 AT（RFC 7009 SHOULD） | OIDC §7 | **决策 D2 → 记录偏差** | P3 |
| F10 | 版本字面量漂移（0.8.1/0.8 注释） | GW §5 | **修复** | P2 |
| F11 | JWT 未显式类型化（RFC 8725 §3.11） | GW §2 | **修复**（带兼容期） | P3 |
| F12 | Gateway validate_aud=false（RFC 8725 §3.9） | GW §2 | **修复**（配置驱动） | P3 |
| F13 | Gateway 手写 exp 比较无 leeway | GW §2 | **修复** | P3 |
| F14 | RT 无条件发放（OIDC Core §11） | OIDC §3 | **决策 D4** | P3 |
| F15 | 错误重定向未回 client redirect_uri（RFC 6749 §4.1.2.1 SHOULD） | 本规划新发现 | **决策 D1** | P3 |
| F16 | code 二次 `used:true` 更新冗余 | OIDC §3 | **修复**（清理，随 F1） | P1 |
| F17 | discovery 自定义字段未用 x- 前缀 | OIDC §7 | **记录偏差**（内部契约，两端同步改反而引入漂移风险） | — |
| F18 | userinfo Cookie 回退取 token 非标准 | OIDC §5 | **记录偏差**（补文档注释即可，随 F4） | P1 |
| F19 | pingora-limits Rate 为估计器 | GW §3 | **记录偏差**（爆破防护场景足够，已在代码注释声明单机取舍） | — |
| F20 | jsonwebtoken 9.3.0 → 9.3.1 / redis 1.x 跟进 | GW §5 | **修复**（`cargo update` + RustSec 核查） | P2 |
| F21 | `-u` 零停机升级未纳入部署 runbook | GW §1 | **修复**（部署文档 + 演练清单，无代码） | P2 |
| F22 | `logging` 回调缺位（统一访问日志） | GW §4 | **记录偏差**（当前 metrics+tracing 已覆盖验收需要；多节点化后重评） | — |
| F23 | `is_tracked_path` 与 PathMatcher 双路径谓词 | GW §3 | **记录偏差**（有测试覆盖；随 F8 重构时顺手收敛，不单独立项） | — |

---

## 3. P1 修复项详细设计

### F1 — token 端点强制 redirect_uri（RFC 6749 §4.1.3）

**根因**：`token/route.ts:80` 比对逻辑写成 `if (redirect_uri && authCode.redirectUri !== redirect_uri)`，把规范里"authorize 携带过则 REQUIRED"实现成"可选才比对"。

**解法**：
1. `TokenSchema` 改造：`redirect_uri` 保持 optional（refresh_token grant 不需要），用 `superRefine` 按 grant_type 分叉——`grant_type === 'authorization_code'` 时 `redirect_uri` 必填。
2. 领取成功后的比对去掉前置条件：`authCode.redirectUri !== redirect_uri` 恒比对（authorize 端点已强制 `z.string().url()`，故授权码行必有 redirectUri）。
3. 顺带删除 `token/route.ts:91` 的冗余二次 `set({ used: true })`（F16，原子领取 SQL 已置位）。

**兼容证据**：Gateway（oauth.rs:308-323）与 Portal callback（route.ts:87）均已携带 ✅；标准第三方 RP 在 authorize 被强制要求 redirect_uri 后，token 阶段发送同一值是 RFC 6749 §4.1.3 的既有义务。

**验证**：`__tests__/api/session-lifecycle.test.ts` 增补——缺失 redirect_uri → 400；不匹配 → invalid_grant；匹配 → 200；refresh_token grant 不受影响。

### F2 — 实现 client_secret_basic（RFC 6749 §2.3.1）

**根因**：三端点统一走 `authenticateOAuthClient(clientId, clientSecret)`，凭证只来自 `parseOAuthBody`；`Authorization: Basic` 从未解析。

**解法**：
1. 新增 `lib/auth/client-credentials.ts`：`resolveClientCredentials(request, body)`——优先解析 `Authorization: Basic base64(client_id:client_secret)`（注意 RFC 6749 §2.3.1：Basic 凭证内的 client_id/secret 是 **application/x-www-form-urlencoded** 编码，需 decodeURIComponent），无 Basic 头时回退 body 字段；两者并存时以 Basic 为准并拒绝冲突（防混淆）。
2. token/introspect/revoke 三端点改调 `resolveClientCredentials`，仍汇入 `authenticateOAuthClient`（bcrypt/SHA-256 双轨定时安全比较不动）。
3. public client（`isPublic`）继续允许无凭证（广告中的 `none`）。

**触达文件**：`apps/portal/src/lib/auth/client-credentials.ts`（新）、`oauth-helpers.ts`、`token|introspect|revoke/route.ts`。

**验证**：单测——Basic 成功 / Basic 中带 `:` 与 urlencoded 特殊字符 / body 回退 / Basic+body 冲突拒绝 / public client 无凭证放行；既有 `client-api.test.ts` 回归。

### F3 — JWKS 轮换重叠窗口

**根因**（两个叠加）：
- `getActiveSigningKey`（signing-keys.ts:107-113）只取最新行，**过期后才生成**新密钥；
- `jwks/route.ts:22-29` 过滤 `expiresAt > now`，过期公钥**立即**从 JWKS 消失。

净效果：90 天轮换瞬间 JWKS 只剩新 kid（或短暂旧 kid），持旧 AT（1h TTL）的外部验签方冷启动后 kid 未命中。

**解法**（双管齐下，Portal 侧根治）：
1. **提前轮换**：`getActiveSigningKey` 的选取条件从"最新且未过期"改为"最新且未进入续期窗口"——`RENEW_AHEAD = 24h`（expiresAt - 24h 之前仍可用作签名密钥，之后生成新行）。生成逻辑与 keyGenLock 串行化不变，只需调整 `needsGen` 判定与重检条件。
2. **发布宽限**：`jwks/route.ts` 过滤改为 `expiresAt > now - JWKS_PUBLISH_GRACE`，`JWKS_PUBLISH_GRACE = 2h`（≥ max(AT_TTL, ID_TOKEN_TTL) = 1h + 时钟偏移余量）。旧公钥在过期后仍发布 2h，随后自然移除。
3. `getSigningKeyByKid`（Portal 自验签）已不筛过期 ✅ 不动；Gateway 侧 24h 缓存宽限（jwks.rs:21）已覆盖缓存内场景，不动。

**常量归置**：`JWKS_PUBLISH_GRACE`/`RENEW_AHEAD` 放 `@auth-sso/contracts`（TOKEN_TTL 同文件），保持枚举唯一真相源。

**验证**：signing-keys 单测——过期前 25h/23h/1h 三点选取行为；jwks route 单测——过期后 1h 内旧 kid 仍在 JWKS、3h 后消失；集成——轮换后旧 AT 仍可被"冷启动 JWKS 拉取"验签。

### F4 — userinfo 401 补 WWW-Authenticate（RFC 6750 §3）

**解法**：`userinfo/route.ts` 两处 401 补 `WWW-Authenticate: Bearer`（无凭证分支不带 error 属性；无效 token 分支带 `error="invalid_token"`）；顺手补"Cookie 回退为门户自用扩展"的注释（F18）。

**验证**：`session-lifecycle.test.ts` 增补 header 断言（区分无凭证/无效 token 两分支）。

---

## 4. P2 修复项设计

### F5 — RFC 9207 iss 参数

`issueCodeAndRedirect` 的成功 302（authorize/route.ts:114-116）追加 `iss` 参数（值 = `getIssuer()`）；`buildOAuthErrorRedirect` 的错误 URL 同样附加 `iss`（RFC 9207 对授权响应含错误响应均适用）；discovery 增补 `authorization_response_iss_parameter_supported: true`。Gateway callback 解析用 `query_param` 精确匹配（gateway.rs:184-188），新增参数零影响。Portal 自身 callback 校验 iss 与 discovery 一致（防 mix-up，与 state 校验并列）。

### F6 — introspect scope 透传 + 注释修正

`introspect/route.ts:54-62` AT 分支响应增加 `scope: claims.scope`（存在时）；§52-53 注释改为如实描述"AT 携带 scope（signAccessToken），ADR-006 剥离的是 RBAC 鉴权数据，OAuth 协议数据不在此列（ADR-006 分层备忘）"。RT 分支不动。

### F7 — code 重放检测与家族撤销（RFC 9700 §4.2.4）

原子领取返回空时，追加一次回查：`WHERE code = ? AND clientId = ? AND used = true`（不再限 expiresAt 未过期——过期 code 重放同样该记审计）——命中即视为重放：写 `TOKEN_EXCHANGE_FAILED` 审计日志（含 codeId），并对该 `(userId, clientId)` 执行 RT 家族撤销（复用 `rotateRefreshToken` 内的家族撤销语义，抽为 `revokeRefreshTokenFamily(userId, clientId)` 供两处调用）。与 F7 无关的普通坏 code（查无此行）不触发撤销（防 DoS 借随机 code 撤他人家族——撤销仅锚定真实存在过且已消费的 code 行）。

### F8 — Gateway 上游健康检查（先 spike 后实施）

**Spike（0.5d）**：核对 docs.rs/pingora-load-balancing 0.9.0 的 health_check 模块 API（研究笔记标注未逐字核对），确认主动探活（BackgroundService 周期 TCP/HTTP 探测 → LB 摘除）与被动探活（fail_to_connect → 计数熔断）两条路径的官方用法。
**实施**：优先官方主动健康检查——`HealthCheck` 服务复用 `upstream_scheme`，对每个 RouteEntry 的 LB 节点周期探测（探 `/` 或可配置路径），摘除节点；`select=None` 的 502 兜底保留。若 0.9 API 不支持主动式，退回被动方案：`fail_to_connect` 覆写 + 原子计数 + 冷却窗口。
**验证**：集成测试——双节点（一真一假）下假节点摘除后流量全落真节点；单节点宕机时 502 行为不变。

### F10 — 版本字面量

`main.rs:37` "Pingora 0.8.1" → "0.9.0"；`gateway.rs:22` 注释 "pingora-load-balancing 0.8" → "0.9"。全库 `grep -rn "0\.8" apps/gateway/src` 扫尾同类。完成后 `cargo clippy --all-targets --all-features -- -D warnings` + `cargo fmt --all -- --check`（AGENTS.md 硬性门禁）。

### F20 / F21 — 依赖跟进与升级 runbook

- `cargo update -p jsonwebtoken`（→9.3.1，升级前查 RustSec；9.x 线内 API 不变，改动应为零）与 redis 1.x patch 跟进；跑 gateway 全测试 + benches 编译。
- `docs/` 部署文档新增"零停机升级"节：`-u/--upgrade` 机制、fd 交接前提（同配置同端口）、升级后验证清单（JWKS/Redis 就绪门控、ACME 状态目录、HMAC 密钥）。

---

## 5. P3 修复项与决策项

### F11 — JWT 显式类型化（RFC 8725 §3.11）

- contracts 增 `JWT_TYP = { ACCESS: 'at+jwt', LOGIN: 'login+jwt', ID: 'id+jwt' }`（枚举唯一真相源）。
- Portal `signLoginSession/signAccessToken/signIdToken` 的 `setProtectedHeader` 增加 `typ`；`verifyAccessToken` 校验 `header.typ`。
- Gateway `verify.rs` 在 `decode_header` 后校验 typ：**存在且不匹配即拒；缺失放行**（兼容存量 token 自然过期：AT 1h / LoginSession 5min / ID Token 1h——上线后 1h 窗口内存量清零，随后可收紧为强制）。
- 效果：新签发的 LoginSession（typ=login+jwt）被 Gateway/AT 语义立即隔离，消除跨用途类型混淆。

### F12 — Gateway aud 校验（RFC 8725 §3.9）

`GatewayConfig` 增 `jwt_audience: Option<String>`（env `GATEWAY_JWT_AUDIENCE`，默认 None 保持现行为）；`fetch_oidc_metadata` 中 `Some(aud) => validation.set_audience(&[aud])`。默认关闭零行为变化；ADR-012 决策 4（per-client aud）落地时部署侧打开即可，Gateway 侧无再发版。

### F13 — exp 手写比较 leeway

`verify.rs:146-154` 的 `exp < now` 改为 `exp + JWKT_EXP_LEEWAY_SECS(60) < now`；`NearlyExpired` 阈值判定同步。常量入 config（默认 60s）。

### 决策项（实施前需确认）

| # | 决策 | 选项 | 推荐 |
|---|------|------|------|
| D1 | F15 错误重定向是否回 RP redirect_uri | (a) 维持 Portal /oauth/error 页（现状简单，不向未验证 RP 泄露回跳）(b) redirect_uri 已验证时按 §4.1.2.1 重定向回 RP（error+state+iss） | (b)，但仅限"redirect_uri 已通过白名单校验"分支；authorize 参数解析失败仍走本地错误页 |
| D2 | F9 revoke 级联（RFC 7009 §2.1 SHOULD） | (a) 撤 RT 时撤销该用户全部 AT jti——**与 token.ts 既有"防跨 client DoS 放大"原则冲突** (b) 记录偏差：AT claims 无 clientId（ADR-006 最小化），"同 grant"无法定位；待 ADR-012 决策 4（per-client 协议数据）落地后以 familyId 实现精确级联 | (b)，偏差写进 ADR-004 备注 + research 笔记链接 |
| D3 | F14 RT 是否按 offline_access 门控 | (a) 维持无条件发放（AS 自由裁量，暴露面大）(b) 按 scope 门控——需先盘点 DB 中已注册 client 的 scopes 是否都含 offline_access，缺失的老 client 需迁移 | (b)，但先跑 client inventory，作为独立小任务排期 |
| D4 | F20 RustSec 核查方式 | 升级 PR 中附 cargo-audit 输出 | 直接执行，无需决策 |

---

## 6. 实施顺序与验证门禁

```text
Phase 1（P1，Portal 侧，可一个 PR）
  F1+F16 → F2 → F3 → F4+F18
  验证：pnpm vitest（api project 真实 PG/Redis 基线）+ 手工 OIDC conformance 冒烟（gateway 全流程登录）
Phase 2（P2）
  F5 → F6 → F7（Portal）          F8（Gateway，spike 先行）     F10+F20+F21（Gateway）
  验证：vitest + cargo clippy -D warnings + cargo fmt --check + gateway 集成测试（双节点健康检查用例）
Phase 3（P3，决策项落定后）
  F11（typ，带 1h 兼容窗口）→ F12 → F13；D1/D2/D3 结论落文档
验证：两端全量测试 + E2E Playwright（Chromium，baseURL 4102）
```

每阶段完成后按 AGENTS.md 沉淀：`docs/solution/` 新增"OAuth 端点元数据一致性""JWT 密钥轮换重叠窗口""JWT 显式类型化"三篇最佳实践（总结-审阅-修订同类问题的固化产物）。

## 7. 兼容性矩阵（受影响方）

| 受影响方 | 变更 | 兼容性 |
|---------|------|--------|
| Gateway（OAuth Client） | F1 需 redirect_uri——**已携带** ✅；F2 Basic——不感知（继续 body 凭证，服务端双轨）✅；F3/F11/F12/F13——零代码变更 | 零破坏 |
| Portal Admin UI | F1——callback 已携带 ✅；F5——callback 需增 iss 校验（同 PR 内完成） | 零破坏 |
| 第三方 RP | F1/F2——本就是 RFC 6749 §4.1.3/§2.3.1 既有义务；F2 反而解锁了默认发 Basic 的主流 RP 库 | 正向收益 |
| 存量 AT/LoginSession | F11 typ——1h 内自然过期 | 自动迁移 |
| 存量注册 client | D3——需 scopes 盘点（决策后执行） | 待盘点 |

## 8. 测试要点汇总

1. token 端点：redirect_uri 缺失 400 / 不匹配 invalid_grant / 匹配 200 / refresh grant 免检；code 重放 → 家族撤销 + 审计日志；Basic/post/none 三认证方式矩阵。
2. JWKS：轮换三点选取；发布宽限窗口边界（过期 +1h 在 / +3h 不在）；冷启动验签旧 AT 集成用例。
3. userinfo：两分支 WWW-Authenticate header 断言。
4. iss：authorize 成功/错误 302 均含 iss；discovery 新元数据字段。
5. Gateway：typ 缺失放行 / 不匹配拒绝 / login token 冒充 AT 拒绝；aud 配置开启后 aud 不符拒绝；健康检查摘除节点；clippy/fmt 全绿。

## 9. 决策项执行记录（2026-09-30）

- **D1（已执行，推荐方案 b）**：新增 `buildRfc6749ErrorRedirect`——redirect_uri 通过白名单校验后的授权拒绝（scope 越界、user_inactive、准入拒绝）重定向回 RP 并携带 error/error_description/state/iss（RFC 6749 §4.1.2.1 + RFC 9207）；redirect_uri 未验证的失败仍走本地 /oauth/error 页。修复中顺带修正 GET handler `return promise` 缺 `await` 导致异步拒绝穿透 catch 的潜在缺陷（测试首次暴露）。测试：`oauth2-authorize.test.ts`（5 用例）。
- **D2（已执行，推荐方案 b）**：偏差记录落 ADR-004"已记录偏差"节，AT 家族级联撤销待 ADR-012 决策 4。
- **D3（已执行，推荐方案 b）**：client inventory（开发库 clients 为空、种子与 Gateway 流程均含 offline_access，Portal 自身无独立 scope 来源）确认零破坏后，token 端点 RT 发放按 offline_access 门控（OIDC Core §11），未请求时响应省略 refresh_token 字段。测试：`oauth2-token.test.ts` D3 组（2 用例）。
- **D4（无需执行）**：jsonwebtoken 锁定版本本为 9.3.1、redis 1.2.4，RustSec 项无需动作。
