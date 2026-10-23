# ADR-013: OAuth 协议数据回归 AT —— per-client aud、client_id claim 与跨 client 重放防线

| 属性       | 值                                                                    |
|------------|-----------------------------------------------------------------------|
| **状态**   | implemented (2026-09-30) —— 实施记录见 `docs/archive/plans/2026-09-30-adr-013-per-client-aud-implementation.md` |
| **日期**   | 2026-09-30                                                            |
| **决策者** | Auth-SSO 团队（/grill-with-docs 定案）                                 |
| **影响范围** | AT claims 契约（TS/Rust 双端）、Gateway aud/typ 校验、introspect 响应、token 端点签发 |

## 背景

ADR-006 JWT 最小化时把两类数据一并剥离：RBAC 鉴权数据（roles/permissions/deptIds）与 OAuth 协议数据（aud/scope/client_id）。其中 scope 已在 AT 携带（introspect 透传由 F6 补齐）；`aud` 至今恒为体系级 `PORTAL_AUD = 'auth-sso'`，AT 不携带 client 身份。三个事实使现状从"可接受的取舍"变为"必须闭合的威胁面"：

1. **跨 client token 替代风险**（research §5.3）：Gateway 验签只看 签名 + iss + typ + jti，不看 aud。第三方 RP 直连 token 端点获得的 AT 可被重放到 Gateway 的 upstream 请求，冒充该用户的 SSO 会话——Gateway 无法区分"发给 portal 的 AT"与"发给 RP-A 的 AT"。F1/F2（redirect_uri 强制比对、client_secret_basic）落地后第三方 RP 成为一等公民，该风险从理论变为现实暴露面。
2. **typ 防不了跨 client**：RFC 8725 §3.11 typ（F11）封住了 login+jwt 冒充 at+jwt 的同体系类型混淆；aud 缺失使 RFC 8725 §3.9 的受众约束完全失守。
3. **悬置的文档债**：ADR-012 决策 4 只是"分层备忘"，ADR-004 的 RFC 7009 级联偏差挂在"待决策 4 落地"上，两处下游引用无法闭合。

2026-09-30 /grill-with-docs 会话对 aud 值域、claim 取舍、级联偏差、文档落点逐项定案。

## 决策

### 1. AT 的 aud = 签发对象 client_id（单值字符串）

- `signAccessToken` 增加 clientId 入参，`aud = clientId` 并显式携带 `client_id` claim（两者同源同值）。
- 语义："该 AT 为此 client 的授权签发"。经 Gateway / Portal 自身流程恒为 `PORTAL_CLIENT_ID = 'portal'`（contracts 已有常量）；第三方 RP 直连则为各自 client_id。
- **LoginSession 维持体系级 `aud = auth-sso`**——签发于 authorize 冷登录桥接，无 client 上下文；Gateway 侧 typ（login+jwt）已将其与 AT 隔离。
- ID Token 不变（aud = client_id 本就是 OIDC Core §2 义务）。
- 备选 RFC 8707 resource indicator（aud = RS 受众）被否：本系统无 RS 注册概念，子应用经 Gateway 注入身份、不自行验签；待第三方 RS 上量再演进（见"演进路径"）。

### 2. Gateway aud 校验常开、自动推导

- 验签 audience 自动取 `gateway.oauth.client_id`（`validation.set_audience(&[client_id])`）——aud 语义定案为 client_id 后，"预期受众"与"自身 client 身份"是同一事实，独立配置（F12 引入的 `GATEWAY_JWT_AUDIENCE` env，尚未提交）成为冗余配置面，就地删除。
- 无运行时开关、无逃生门（ADR-011 精神：正确性校验不设 fail-open 开关）。
- typ 校验同步收紧为**强制存在**（缺失即拒）——系统无生产存量 token，F11 的"缺失放行"兼容窗无需开启。

### 3. client_id claim 与 introspect 齐备化

- AT payload 显式携带 `client_id`（RFC 9068 JWT-AT profile 形态）。
- introspect AT 分支响应透传 `aud` / `client_id`（`scope` 已由 F6 先行透传），替代 ADR-012 决策 3 的"诚实省略"——省略的前提（AT 无此数据）已被本决策消除。
- 跨语言 claims 契约 `jwt-claims-fixture.json` 同步：`aud → "portal"`、新增 `client_id`；Rust `Claims` 增加 `client_id` 字段（serde 显式 `rename = "client_id"`，防 `rename_all = "camelCase"` 误配为 `clientId`）。

### 4. RFC 7009 §2.1 AT 级联：有意接受不实现

决策 1/3 落地后技术上已可定位 (userId, clientId) 家族的 AT，但评估后仍不实现 AT 级联撤销：

- AT TTL 1h 是 ADR-011 §4 认可的正确撤销杠杆（OCSP 业界等价物为短有效期证书）；泄露 AT 的残余风险 ≤ 1h。
- RT 家族撤销（RFC 9700 §4.14）已闭合续期能力——泄露 RT 无法换取新 AT。
- per-family 活跃 jti 集合需新 Redis 键空间 + 成员级过期（ZSET score=exp）+ 每次签发 SADD 写放大，复杂度与 SHOULD（非 MUST）收益不成比例。
- **重评触发条件**：AT TTL 延长、对标 FAPI 2.0、合规审计强制 RFC 7009 级联。
- ADR-004 偏差节已从"暂缓待决策 4"改写为"有意接受"。

### 5. 发布顺序（两端耦合的部署约束）

1. **Portal 先发**：新 AT `aud = client_id` + `client_id` claim；存量 Gateway 无 aud 校验，新旧 AT 双接受。
2. **Gateway 后发**：开始强制 `aud == client_id` + typ 强制 + `client_id` 字段必填；发布前存量的 aud=auth-sso AT 已 ≤1h 自然过期（无生产存量，仅开发环境）。

逆序（Gateway 先发）会拒绝全部存量 AT，触发全量重认证——发布 runbook 必须锁定此顺序。

## 后果

### 正面

- 跨 client token 替代路径封闭：Gateway 拒绝非自身 client 的 AT，RFC 8725 §3.9 落地且零配置。
- introspect 响应协议齐备（RFC 7662 的 aud/client_id/scope），第三方 RS 排障与按 client 策略可行。
- aud 语义从"体系级占位"变为规范语义（受众 = 授权对象），与 ID Token 一致。

### 需承担

- 跨语言 Claims 契约 +1 字段，fixture 双端测试同步。
- 发布顺序耦合（Portal → Gateway），需写入部署 runbook。
- LoginSession 与 AT 的 aud 双语义并存（auth-sso / client_id），需注释与文档明确区分。

## 演进路径（明确不做，留口）

- **RFC 8707 resource indicators**：RS 注册概念出现时，aud 演进为受众数组，`client_id` claim 保持签发方语义。
- **DPoP / mTLS sender-constrained**：触发条件见 research §4（第三方 RS 上量 / FAPI 2.0 对标）。
- **AT 家族级联撤销**：触发条件见决策 4。

## 相关 ADR

- ADR-006: JWT 最小化（RBAC 剥离维持；协议数据回归由本 ADR 定案）
- ADR-012: 决策 4 分层备忘由本 ADR 落地
- ADR-004: RFC 7009 级联偏差改写为有意接受
- ADR-010: Gateway 统一 OAuth Client（aud 校验目标 = 自身 client_id 的前提）
- ADR-011: 故障语义分级（正确性校验无运行时开关的依据）

## 验证（2026-10-16 补：活体核实）

按"已记录但未活体验证的历史决策"逐条读实现取证，**四条决策全部为真**：

| 决策 | 证据（file:line） | 判定 |
|---|---|---|
| ① `signAccessToken` 增 `clientId` 入参；`aud = clientId` 且显式带 `client_id` claim（**同源同值**） | `apps/portal/src/lib/auth/token.ts:86`（形参）、`:97`（payload `client_id: clientId`）、`:101`（`.setAudience(clientId)`）；`:80` 注释"aud 与 client_id claim 的唯一来源" | 真 |
| ② Gateway audience **自动取 `gateway.oauth.client_id`** | **`apps/gateway/src/main.rs:68-70` = `JwksCache::with_audience(config.gateway.oauth.client_id.clone())`**（一路查到注入点）；`jwks.rs:209-211` 注明默认值与配置默认一致；`GATEWAY_JWT_AUDIENCE` 在 `config.rs` **零命中**（独立配置面确已删除） | 真 |
| ② `typ` 收紧为**强制存在**（缺失即拒、无兼容窗） | `apps/gateway/src/auth/verify.rs:59-60`（`MissingTyp` 错误）、`:126-128`（"必须存在且为 at+jwt；『缺失放行』兼容窗不再开启"） | 真 |
| ③ 跨语言契约同步 `aud` / `client_id` | `packages/contracts/src/jwt-claims-fixture.json:4-5` = `"aud": "portal"`、`"client_id": "portal"` | 真 |
| ④ RFC 7009 §2.1 AT 级联**有意不实现** | 未发现 **per-family**（`(userId, clientId)`）AT 级联；存在的 `revokeUserAccessByUserId`（`apps/portal/src/lib/session/revoke.ts:106-130`）是**用户级** AT 撤销（ADR-011 机制，封禁/强制下线），与决策 ④ 所指的家族级级联**不是一回事** | 真（与代码一致） |

**决策 ④ 的辨析**（值得写下来，避免后人误判为"已实现"）：本仓现有的是**用户级** AT 撤销
（清该用户全部 jti）与 **RT 家族**撤销（RFC 9700 §4.14）；ADR-013 决策 ④ 拒绝的是
"**RT 家族撤销时级联撤销同家族 AT**"。三者粒度不同，因此"存在 `revokeUserAccessByUserId`"
**不构成**对决策 ④ 的推翻。

## 增补（2026-10-23）：per-client TTL —— `exp` 来源补齐 per-client 维度（决策 D15）

本文决策 1 把「AT 的 `aud`/`client_id`」定义为 per-client 语义，但**令牌有效期**当时仍是全局常量
（`TOKEN_TTL.ACCESS_TOKEN` / `TOKEN_TTL.REFRESH_TOKEN`），而 `clients` 表的
`access_token_ttl` / `refresh_token_ttl` 从 v3 起就存在、管理面可编辑——形成"配置不生效"的
声明↔实现漂移（审计 H-16）。

**补充决策：per-client TTL 生效，并经受服务端钳制后落进 `exp` / `expires_in` / RT
`expires_at` / Cookie `maxAge` 四处（四者同源同值）。**

- 钳制边界：AT `[60s, 24h]`、RT `[5min, 30d]`；缺失/非法回退全局默认（3600 / 604800）；
  越界收敛到边界。实现 `apps/portal/src/lib/auth/token.ts:81-89`（`ACCESS_TOKEN_TTL_BOUNDS` /
  `REFRESH_TOKEN_TTL_BOUNDS` / `clampTokenTtl`）。
- 生效点：授权码兑换（`lib/auth/oauth-grant.ts`）、RT 轮换（`lib/auth/token.ts:332` 起）、
  Portal 静默续签 Cookie（`app/api/auth/refresh/route.ts`）。
- **不减损本文决策 4 的撤销杠杆假设**：钳制上界（24h）保证单个 client 不能把 AT 拉长到
  让 jti 黑名单成为唯一防线；超长 TTL 需求必须走全局部署配置评审。
- 完整理由、边界依据与验证清单见 **ADR-024**（本 ADR 只记录"与 per-client aud 同源"的关联）。

关联验证：`apps/portal/__tests__/api/oauth2-token.test.ts:466`（per-client TTL 生效/钳制/
refresh grant 同源），审计证据 `.zcode/audit/portal-crud/evidence-02-h16-oauth.json`。
