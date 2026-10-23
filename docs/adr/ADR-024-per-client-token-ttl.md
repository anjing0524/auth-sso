# ADR-024: 按 OAuth Client 配置令牌有效期（per-client TTL）与服务端钳制

| 属性       | 值                                                                    |
|------------|-----------------------------------------------------------------------|
| **状态**   | accepted / implemented (2026-10-23)                                   |
| **日期**   | 2026-10-23                                                            |
| **决策者** | Auth-SSO 团队（安全审计批次 D1–D17，决策 D15）                          |
| **影响范围** | `clients.access_token_ttl` / `clients.refresh_token_ttl`、`lib/auth/token.ts`、`lib/auth/oauth-grant.ts`、`app/api/auth/refresh/route.ts`、`docs/spec/{API,DATABASE}.md` |
| **关联**   | ADR-013（per-client aud / OAuth 协议数据回归）、ADR-004/011（短 AT TTL 是撤销杠杆） |

## 背景

`clients` 表从 v3 起就有两列：`access_token_ttl`（默认 3600 秒）与 `refresh_token_ttl`
（默认 604800 秒，7 天）。管理面（`/clients/new`、`/clients/[id]`）可编辑并展示它们，
`docs/spec/DATABASE.md` 也把它们定义为"该客户端签发令牌的有效期"。

但签发实现从未读取这两列：`signAccessToken`/`issueRefreshToken` 使用全局常量
`TOKEN_TTL.ACCESS_TOKEN` / `TOKEN_TTL.REFRESH_TOKEN`。审计实测（H-16）：把 client 的
`access_token_ttl` 改为 60 后，token 端点的 `expires_in` 仍是 3600，JWT `exp-iat` 仍是 3600。

这是典型的「**声明↔实现漂移**」：管理面提供一个不生效的配置，比没有配置更危险——接入方
会按页面上的 TTL 设计重试/续期策略，而实际令牌寿命与之不符。

## 决策

**per-client TTL 生效，且必须经服务端钳制（clamp）；锁定语义为"配置值落在边界内即生效"。**

### 1. 生效点（三条签发路径全覆盖）

| 路径 | 读取来源 | 实现 |
|---|---|---|
| 授权码兑换（authorization_code grant） | 已认证 client 行 | `lib/auth/oauth-grant.ts:138` 起：`exchangeAuthorizationCode` 把 `client.accessTokenTtl/refreshTokenTtl` 传给签发函数；响应 `expires_in` 用**实际签发值**（`:205`），不再手抄全局常量 |
| Refresh Token 轮换（refresh_token grant） | 发放 RT 的 client 行（`rt.clientId`）——与授权码路径同源 | `lib/auth/token.ts:332` `rotateRefreshToken`：事务内读 `clients` 的两列，分别钳制后用于新 AT/新 RT |
| Portal 自身静默续签（`POST /api/auth/refresh`） | 同轮换路径 | `app/api/auth/refresh/route.ts`：Cookie `maxAge` 使用 `result.refreshExpiresIn`（实际 RT TTL），不再用全局常量 |

签发函数签名新增可选的 client TTL 入参：
`signAccessToken(userId, clientId, scope?, clientAccessTokenTtl?)`、
`issueRefreshToken(userId, clientId, scopes?, clientRefreshTokenTtl?)`
（`lib/auth/token.ts:113`、`:287`）。

### 2. 钳制边界（服务端强制，不信任配置）

```ts
ACCESS_TOKEN_TTL_BOUNDS  = { min: 60,  max: 24 * 60 * 60 }        // 60s ~ 24h
REFRESH_TOKEN_TTL_BOUNDS = { min: 5 * 60, max: 30 * 24 * 60 * 60 } // 5min ~ 30d
```

实现：`lib/auth/token.ts:81`（边界常量）、`:89`（`clampTokenTtl`）。

- 缺失 / 非数字 / 非有限数 / ≤0 ⇒ **回退全局默认**（3600 / 604800），不抛错；
- 越界 ⇒ 收敛到最近的边界值（不静默接受极端值）；
- 声明周期层面：`expires_in`、JWT `exp`、RT 行 `expires_at`、Cookie `maxAge` **必须同源同值**
  （`RefreshTokenResult` 新增 `refreshExpiresIn`，`domain/auth/types.ts`）。

边界取值的依据（不是任意数字）：

- **AT 下限 60s**：低于 60s 会让正常页面请求间歇性 401，且无法抵消任何泄漏风险
  （反而增加续签频率与 RT 暴露面）。
- **AT 上限 24h**：ADR-013 决策 4 的"AT TTL 是撤销杠杆"假设以「≤1h」为基线；24h 是
  "允许特殊场景放宽"与"不放弃 jti 撤销杠杆"的折中上界。超过 24h 时应走全局部署配置评审，
  而不是让单个 client 静默削弱撤销语义。
- **RT 下限 5min / 上限 30d**：与"会话可续期"和"长期凭证暴露面"的既有取舍对齐；
  更短无意义（用户会持续掉线），更长则实质接近永久凭证。

### 3. 与既有决策的关系（不是推翻，而是补齐）

- **不减损 ADR-013**：`aud = client_id`、`client_id` claim、`typ` 强制、`audience` 推导
  全部不变；本 ADR 只让 `exp` 的来源从"全局常量"变成"client 配置（钳制后）"。
- **不改变 ADR-011 的撤销杠杆**：AT 的撤销仍主要靠 jti 黑名单（fail-close）+ 短 TTL；
  钳制上限保证"单个 client 不能把 AT 拉长到让黑名单成为唯一防线"。
- **与 ADR-004 的一项一致性**：`users` 的 `token` 有效期不再有单一全局值，`API.md`
  的 `expires_in` 必须描述为"该 client 配置并钳制后的值"。

## 后果

**收益**

- 管理面的 TTL 配置与其展示语义一致；接入方可按 client 生命周期调参（例如 CLI 客户端用
  短 AT + 长 RT，管理类集成用默认值）。
- `expires_in` 与实际 JWT `exp`、RT 行、Cookie `maxAge` 四处同源，消除"响应承诺与令牌不符"
  这一类协议缺陷（此前 1 秒级偏差已在 `signAccessToken` 用同一 `now` 修复，本 ADR 把
  值来源也统一）。
- 钳制把"脏配置/恶意配置"的影响限制在边界内，不需要在 UI/DB 加 CHECK 约束即可安全。

**代价**

- 每次 RT 轮换事务内多一次 `clients` 查询（按主键，成本可忽略；且与后续 `resolveIssuancePermission`
  的 DB 往返同一量级）。
- `RefreshTokenResult` 增加字段（`refreshExpiresIn`），两个消费点（oauth token 响应、
  refresh Cookie）需同步——由 TypeScript 编译器点名（已完成）。
- 边界值是**产品/安全折中**，写死为常量；若将来需要按 client 类型分档，应新增枚举列而不是
  放宽边界（防止"配置即绕过"）。

## 验证

| 断言 | 证据 |
|---|---|
| DB client TTL=60/300 → 响应 `expires_in=60`、JWT `exp-iat=60`、RT 到期≈300s | `apps/portal/__tests__/api/oauth2-token.test.ts:467` |
| refresh_token grant 同样按 client TTL 签发 | `oauth2-token.test.ts:486` |
| 非法 TTL（1）被钳制到下限 60/300，不返回 500 | `oauth2-token.test.ts:513` |
| 默认 client（未改配置）仍为 3600/604800（回归） | 既有 `oauth2-token.test.ts` 授权码用例 |

审计证据（修复前死配置复现）：`.zcode/audit/portal-crud/evidence-02-h16-oauth.json`；
修复批次 F4 的门禁记录见 `docs/roadmap.md` 2026-10-23（续九十五）条目。

## 相关 ADR

- ADR-013：per-client aud 与 OAuth 协议数据回归（本 ADR 补齐 TTL 维度的"per-client 语义"）
- ADR-004 / ADR-011：无状态 JWT + jti 黑名单；短 AT TTL 是撤销杠杆（钳制上界的依据）
- ADR-012：OIDC 协议合规（token 响应字段与缓存头）
- ADR-024 与 ADR-023 同批落地（2026-10-23）：一个把"登录凭证绑定"落进字段，一个把
  "per-client 配置"落进签发路径，共同消除"配置/注释与实际不符"的形态。
