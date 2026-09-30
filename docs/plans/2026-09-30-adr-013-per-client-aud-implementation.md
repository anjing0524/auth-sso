# ADR-013 实施计划：per-client aud + client_id claim

**日期**: 2026-09-30
**决策依据**: [ADR-013](../adr/ADR-013-per-client-aud-protocol-claims.md)（accepted）
**状态**: 已实施（2026-09-30）

> 实施偏差记录（相对下述清单）：
> 1. `verifyAccessToken` 的 `audience` 参数改为**必传显式**（非仅改默认值）——LoginSession（auth-sso）与 AT（client_id）双语义并存下，单一默认值本身就是错误设计，8 处调用点全部显式传参。
> 2. `PORTAL_CLIENT_ID` 从 contracts index.ts 收敛至 `oidc.ts`（与 PORTAL_AUD 同置，OIDC 常量单一真相源）。
> 3. revoke 端点顺势收口 RFC 7009 §2.1 归属判定：AT 分支按 `client_id` claim 判定归属后才拉黑 jti，RT 分支 UPDATE 限定当前认证 client——消除跨 client 撤销 DoS 面。
> 4. Gateway `JwksCache::new()` 测试/默认构造以 "portal" 为默认受众（与 `GatewayConfig::default().oauth.client_id` 对齐），生产路径由 main.rs 注入配置值。

> 五条决策：① AT `aud = client_id`（LoginSession 维持 auth-sso）；② Gateway aud 校验常开、自动推导自 `gateway.oauth.client_id`，删除 `GATEWAY_JWT_AUDIENCE`；③ AT 显式携带 `client_id` claim + introspect 齐备化；④ RFC 7009 AT 级联有意接受不实现；⑤ 发布顺序 Portal → Gateway。

## 1. 改动清单

### Portal 签发端

| 位置 | 改动 |
|------|------|
| `lib/auth/token.ts` `signAccessToken` | 签名改为 `(userId, clientId, scope?)`；`setAudience(clientId)`；payload 增 `client_id: clientId` |
| `lib/auth/token.ts` `rotateRefreshToken` | 事务后签发调用改为 `signAccessToken(rt.userId, rt.clientId, rt.scopes)` |
| `app/api/auth/oauth2/token/route.ts` | authorization_code grant 调用点传入已认证 client 的 clientId |
| `domain/auth/types.ts` `PortalJwtClaims` | 增 `client_id?: string`；修正 scope 注释（"不会携带 client 身份"已过时） |
| `lib/session/revoke.ts` 等 signAccessToken 其余调用方 | 全库 grep 调用点逐一适配（编译期暴露，无静默遗漏） |

### Portal 验签端

| 位置 | 改动 |
|------|------|
| `lib/auth/token.ts` `verifyAccessToken` | 默认 `audience` 参数从 `PORTAL_AUD` 改为 `PORTAL_CLIENT_ID`（contracts 已有，`'portal'`） |
| `lib/auth/verify-jwt.ts`（withAuth 链）、`/api/me` | 走新默认值，无需显式传参 |
| `userinfo/route.ts`、`introspect/route.ts` | 保持显式 `null`（多 client 通用端点，aud 由 RS 自判） |

### introspect 齐备化

- `introspect/route.ts` AT 分支响应在 F6 的 `scope` 基础上增 `aud`、`client_id`；§"ADR-006 剥离"相关注释改写为指向 ADR-013。

### contracts / 契约

- `packages/contracts/src/jwt-claims-fixture.json`：`aud → "portal"`、新增 `"client_id": "portal"`。
- `packages/contracts/src/jwt-contract.test.ts`：断言同步。

### Gateway (Rust)

| 位置 | 改动 |
|------|------|
| `config.rs` | 删除 `jwt_audience` 字段与 `GATEWAY_JWT_AUDIENCE` env 解析（F12 引入于未提交工作树，就地废弃）；全库 grep 扫尾 |
| `main.rs:69` | 构造传参改为 `config.gateway.oauth.client_id.clone()` |
| `jwks.rs` | `with_audience(Option<String>)` → 必填 `String`；validation 恒 `set_audience(&[aud])` |
| `auth/verify.rs` | typ 校验收紧为强制存在：`header.typ` 为 `None` 即 `InvalidTokenType`（现"缺失放行"分支删除） |
| `auth/mod.rs` `Claims` | 增 `pub client_id: String`，字段级 `#[serde(rename = "client_id")]`（struct 级 `rename_all = "camelCase"` 会把它误配成 `clientId`） |

## 2. 发布顺序（ADR-013 决策 5）

1. Portal 先发（签发 aud=client_id；旧 Gateway 无 aud 校验，双接受）
2. Gateway 后发（强制 aud==client_id + typ 强制 + client_id 必填；存量 aud=auth-sso 的 dev AT ≤1h 自然过期）

## 3. 测试要点

1. 签发语义：AT 的 aud == client_id、payload 含 client_id claim；LoginSession aud 仍 auth-sso；ID Token aud 仍 client_id。
2. verifyAccessToken：默认受众 portal 通过 / 非 portal AT 拒绝；userinfo/introspect 显式 null 放行任意 client AT。
3. introspect：AT 分支响应含 active/sub/exp/iss/jti/aud/client_id/scope。
4. Gateway：typ 缺失拒绝；aud 不符（auth-sso 存量、他 client AT）拒绝；aud==client_id 通过；fixture serde 反序列化含 client_id。
5. 契约：fixture 双端（TS 签发语义 + Rust serde）同钉。
6. 回归：重放家族撤销、sender 绑定、RT 轮换既有用例全绿。

## 4. 验证门禁

- `pnpm vitest`（api project 真实 PG/Redis 基线）
- `cargo clippy --all-targets --all-features -- -D warnings` + `cargo fmt --all -- --check`（AGENTS.md 硬性门禁）
- Gateway 集成测试 + E2E Chromium 经 Gateway 登录闭环（baseURL 4102）

## 5. 兼容性矩阵

| 受影响方 | 变更 | 影响 |
|---------|------|------|
| Gateway | aud 强制校验 + typ 强制 + Claims +1 字段 | 依赖发布顺序（Portal 先行）；无生产存量 |
| Portal 自身会话 | verify 默认受众 portal | 签发/验签同仓同发布，无窗口 |
| 第三方 RP | 无感（其 AT aud 本就应为其 client_id，RS 侧校验自判） | 正向收益 |
| introspect 消费方 | 响应字段增补（RFC 7662 可选字段） | 纯增量 |
| 部署 runbook | 新增发布顺序约束 | 文档项 |
