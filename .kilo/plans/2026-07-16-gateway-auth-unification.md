# ADR-009 Gateway 认证流统一 — 全量实现计划

> 日期: 2026-07-16
> 来源: `/grilling` Gateway 重构专题（11 轮追问）
> 驱动: ADR-009 + ADR-006/007/008

## 前置依赖（Portal 侧）→ Phase 0

### P0-1: 为 `client_id="portal"` 生成 client_secret

**文件**: `apps/portal/scripts/seed.ts` + `apps/portal/scripts/seed-production.ts`

Portal 的 `client_id = "portal"` 当前 `isInternal = true` 且无 secret。改为生成 bcrypt-hashed secret。secret 明文需输出到控制台，供运维配置到 `gateway.toml`。

### P0-2: 删除 `isInternal` 列及相关逻辑

**文件**：
1. `apps/portal/src/db/schema/auth.ts` — 删除 `isInternal` 列定义
2. `apps/portal/src/app/api/permissions/register/route.ts:118-119` — 删除 `isInternal` 守卫
3. `apps/portal/scripts/seed.ts` + `scripts/seed-production.ts` — 删除 `isInternal` 字段赋值
4. 生成 Drizzle migration (`pnpm db:generate`)

**理由**：`isInternal` 的唯一用途是允许 Portal 客户端跳过 secret 校验和设置特殊 audience。ADR-006 已将 aud 统一为 `"auth-sso"`；ADR-009 要求所有 client 强制使用 secret。该列已无业务价值。

---

## Phase 1: Rust — 认证子系统重构

### 1.1 新增 `AuthDecision` 枚举

**文件**: `apps/gateway/src/auth/mod.rs`

```rust
pub enum AuthDecision {
    Pass,
    Interrupted,
    PkceRequired,
}
```

### 1.2 重写 `authenticate::check`

**文件**: `apps/gateway/src/authenticate.rs`

- 签名增加 `is_html_nav: bool` 参数
- 返回值 `Result<bool>` → `Result<AuthDecision>`
- 用 `match expiry` 替代 `matches!()` 宏（编译器强制穷尽检查）
- 删除 `respond_auth_failure` 函数，提取为 `auth_failure_decision`

核心逻辑：

```
无 AT → HTML → PkceRequired / API → Interrupted(401)
验签失败 → 同上
Valid        → Pass
NearlyExpired → try_refresh(best-effort) + Pass
Expired + RT刷新成功 → Pass
Expired + RT刷新失败 → HTML → PkceRequired / API → Interrupted(401)
```

### 1.3 提取 `auth_failure_decision` helper

```rust
async fn auth_failure_decision(session: &mut Session, is_html_nav: bool) -> Result<AuthDecision> {
    if is_html_nav {
        Ok(AuthDecision::PkceRequired)
    } else {
        session.respond_401().await?;
        crate::metrics::inc_auth_failures();
        Ok(AuthDecision::Interrupted)
    }
}
```

---

## Phase 2: Rust — `request_filter` 精简

### 2.1 删除旧 step 7（~17 行）

**文件**: `apps/gateway/src/gateway.rs` lines 677-693

`hasJwt` Cookie 预判 + 独立 PKCE 302 + 独立 401 删除。此逻辑已统一到 `authenticate::check` 的 `AuthDecision` 返回值。

### 2.2 删除 callback 中的 `oidc_provider_name` 跳过

**文件**: `apps/gateway/src/gateway.rs` line 644

```rust
// 旧
if let Some(oauth) = oauth_config && upstream_name != self.oidc_provider_name
// 新
if path_matches_callback(&path, &oauth.callback_path)
```

### 2.3 删除 callback 透传分支

**文件**: `apps/gateway/src/gateway.rs` lines 652-668

`client_secret.is_some()` 检查删除（必填后恒真）。passthrough 分支（`ctx.oauth_passthrough_verifier` 赋值 + passthrough 逻辑）整块删除。

### 2.4 替换旧 step 8 为统一 `match`

```rust
// 旧
if crate::authenticate::check(session, ctx, &self.jwt_verifier, &self.token_refresher).await? {
    return Ok(true);
}

// 新
match crate::authenticate::check(session, ctx, &self.jwt_verifier, &self.token_refresher, is_html_nav).await? {
    AuthDecision::Pass         => {}  // 继续代理
    AuthDecision::Interrupted  => return Ok(true),  // 已发 401
    AuthDecision::PkceRequired => return self.oauth_authorize_redirect(session, oauth, &path).await,
}
```

### 2.5 `resolve_oauth` 返回类型

```rust
// 旧
fn resolve_oauth<'a>(&'a self, path: &str) -> (&'a str, Option<&'a OAuthConfig>)
// 新
fn resolve_oauth<'a>(&'a self, path: &str) -> (&'a str, &'a OAuthConfig)
```

`oauth_config` 必填后不再有 `Option` 解包和 fallback 逻辑。

---

## Phase 3: Rust — 结构体与配置简化

### 3.1 删除 `Gateway.oidc_provider_name`

**文件**: `apps/gateway/src/gateway.rs` 结构体定义 + `apps/gateway/src/main.rs` 构造函数传参

### 3.2 删除 `GatewayCtx.oauth_passthrough_verifier`

**文件**: `apps/gateway/src/gateway.rs` — 结构体定义、callback 赋值、`upstream_request_filter` 中 `X-OAuth-Code-Verifier` 注入

### 3.3 `OAuthConfig` + `UpstreamConfig` 简化

**文件**: `apps/gateway/src/config.rs`

```rust
pub struct OAuthConfig {
    pub client_id: String,
    pub client_secret: String,     // Option<String> → String
    pub callback_path: String,
}

pub struct UpstreamConfig {
    pub oauth: OAuthConfig,        // Option<OAuthConfig> → OAuthConfig（必填）
    // ... 其他字段不变
}
```

### 3.4 配置校验增强

**文件**: `apps/gateway/src/config.rs` `validate_routing_consistency`

新增：所有 upstream 必须有非空 `oauth.client_id` 和 `oauth.client_secret`。

### 3.5 `Gateway.upstream_oauth` 类型

```rust
// 旧
upstream_oauth: Vec<(String, Option<OAuthConfig>)>,
// 新
upstream_oauth: Vec<(String, OAuthConfig)>,
```

### 3.6 `handle_oauth_callback` 简化

删除 `client_secret.is_some()` 检查（必填后恒真）。删除 passthrough 分支。移除未使用的 `upstream_name` 参数。

---

## Phase 4: Rust — 测试与配置模板

### 4.1 增补 `AuthDecision` 测试

**文件**: `apps/gateway/src/auth/tests.rs`

| 场景 | 期望 |
|------|------|
| 无 AT + HTML nav | `PkceRequired` |
| 无 AT + API | `Interrupted` |
| AT 有效 | `Pass` |
| AT 过期 + RT 续签成功 | `Pass` |
| AT 过期 + RT 过期 + HTML | `PkceRequired` |
| AT 过期 + RT 过期 + API | `Interrupted` |

### 4.2 配置模板更新

**文件**: `apps/gateway/gateway.toml` + `apps/gateway/gateway.docker.toml`

```toml
[[upstreams]]
name = "/"
oidc_provider = true
[upstreams.oauth]
client_id = "portal"
client_secret = "<Portal seed 生成的 secret 明文>"   # ← 必填
callback_path = "/api/auth/callback"

[[upstreams]]
name = "/demo/"
[upstreams.oauth]                                    # ← 必填段
client_id = "demo"
client_secret = "<Demo 注册生成>"
callback_path = "/api/auth/callback"
```

---

## 验证清单

```
1. pnpm db:generate   → Portal migration 生成（isInternal 删除）
2. pnpm typecheck     → Portal TS 编译零错误
3. cargo clippy --all-targets --all-features -- -D warnings  → Gateway 零警告
4. cargo fmt --all -- --check → 格式检查通过
5. cargo test         → Gateway 测试全绿
6. 手动验证: Gateway 启动 → 浏览器访问 → PKCE 流程完整
```

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| Gateway 启动时上游缺 client_secret → 校验失败 | `validate_routing_consistency` 启动期 fail-fast，绝不带错上线 |
| Portal secret 未同步到 gateway.toml → Token 交换失败 | seed 输出打印明文 secret，运维手动复制到配置 |
| 删除 `isInternal` 影响权限注册端点 | 已有 `validateClientSecret` 提供客户端认证，`isInternal` 是冗余限制 |

## 影响文件汇总

| 层 | 文件 | 操作 |
|----|------|------|
| Portal DB | `db/schema/auth.ts` | 删除 `isInternal` 列 |
| Portal | `scripts/seed.ts`, `scripts/seed-production.ts` | 生成 portal secret + 删除 isInternal |
| Portal | `app/api/permissions/register/route.ts` | 删除 isInternal 守卫 |
| Gateway | `auth/mod.rs` | 新增 AuthDecision 枚举 |
| Gateway | `authenticate.rs` | 重写 check，删除 respond_auth_failure |
| Gateway | `gateway.rs` | 精简 request_filter，删除透传/step7/oidc_provider_name/oauth_passthrough_verifier |
| Gateway | `config.rs` | Schema 简化 + 校验增强 |
| Gateway | `main.rs` | 删除 oidc_provider_name 传参 |
| Gateway | `auth/tests.rs` | 增补 AuthDecision 测试 |
| Config | `gateway.toml` + `gateway.docker.toml` | 增加 client_secret 必填字段 |
