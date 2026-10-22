# ADR-009 实现计划 — Gateway 认证流统一（✅ 已实现）

> 日期: 2026-07-16 → 2026-07-23 全量完成
> 来源: `/grilling` — Gateway 重构专题（11 轮追问）
> 驱动文档: ADR-009
> 状态: 全部 Phase 1-6 已完成，`cargo clippy` + `cargo fmt` + `cargo test` 全绿验证通过。

---

## 影响范围

仅 Gateway (Rust) 侧。Portal 侧无代码变更（仅需在 DB 中为 `client_id="portal"` 生成 secret）。

---

## Phase 1: `authenticate::check` 重写

### 1.1 新增 `AuthDecision` 枚举

**文件**: `apps/gateway/src/auth/mod.rs`

```rust
pub enum AuthDecision {
    Pass,
    Interrupted,
    PkceRequired,
}
```

### 1.2 重写 `check` 函数

**文件**: `apps/gateway/src/authenticate.rs`

- 签名增加 `is_html_nav: bool` 参数
- 返回值从 `Result<bool>` 改为 `Result<AuthDecision>`
- 用 `match expiry` 替代 `matches!` 宏
- 删除 `respond_auth_failure` 函数（逻辑内联）

核心逻辑：

```
check(session, ctx, verifier, refresher, is_html_nav):
  token = extract AT from cookie
  if no token → PkceRequired(HTML) / Interrupted(API)
  
  verify(token):
    Err → PkceRequired(HTML) / Interrupted(API)
    Ok → 
      ctx.identity ← Identity
  
      match expiry:
        Valid         → Pass
        NearlyExpired → try_refresh; Pass
        Expired       → try_refresh?
                          yes → Pass
                          no + HTML → PkceRequired
                          no + API  → Interrupted(401)
```

## Phase 2: `request_filter` 精简

### 2.1 删除原 step 7（~37 行）

**文件**: `apps/gateway/src/gateway.rs` lines 677-693

`hasJwt` Cookie 预判逻辑删除。`authenticate::check` 第一行就是提取 AT，重复判断不需要。

### 2.2 删除 callback 中的 `oidc_provider_name` 跳过

**文件**: `apps/gateway/src/gateway.rs` line 644

`&& upstream_name != self.oidc_provider_name` 删除。所有 upstream 统一处理 callback。

### 2.3 删除 callback 透传分支

**文件**: `apps/gateway/src/gateway.rs` lines 652-668

`client_secret.is_some()` 检查删除（必填后恒为真）。透传分支（`ctx.oauth_passthrough_verifier` 赋值）删除。

### 2.4 替换 step 8 调用

```rust
// 旧
if crate::authenticate::check(session, ctx, &self.jwt_verifier, &self.token_refresher).await? {
    return Ok(true);
}

// 新
match crate::authenticate::check(session, ctx, &self.jwt_verifier, &self.token_refresher, is_html_nav).await? {
    AuthDecision::Pass         => {}
    AuthDecision::Interrupted  => return Ok(true),
    AuthDecision::PkceRequired => return self.oauth_authorize_redirect(session, oauth, &path).await,
}
```

### 2.5 传递 `oauth_config`（已从 step 4 获得，作用域覆盖）

`oauth_config` 在 step 4 通过 `self.resolve_oauth(&path)` 获取。改为必填后不再有 `if let Some`，直接可用。

## Phase 3: 结构体与配置简化

### 3.1 `OAuthConfig`

**文件**: `apps/gateway/src/config.rs`

```rust
pub struct OAuthConfig {
    pub client_id: String,
    pub client_secret: String,       // 必填
    pub callback_path: String,
}
```

### 3.2 `UpstreamConfig`

```rust
pub struct UpstreamConfig {
    pub name: String,
    pub addresses: String,
    pub public_paths: Vec<String>,
    pub oidc_provider: bool,
    pub oauth: OAuthConfig,          // 必填（不再 Option）
}
```

### 3.3 配置校验增强

**文件**: `apps/gateway/src/config.rs` — `validate_routing_consistency`

增加校验：所有 upstream 必须配置 `oauth` 段且有非空 `client_secret`。

### 3.4 `Gateway` 结构体

**文件**: `apps/gateway/src/gateway.rs`

| 字段 | 操作 |
|------|------|
| `oidc_provider_name: String` | 删除 |
| `upstream_oauth: Vec<(String, Option<OAuthConfig>)>` | 改为 `Vec<(String, OAuthConfig)>` |

### 3.5 `GatewayCtx`

**文件**: `apps/gateway/src/gateway.rs`

| 字段 | 操作 |
|------|------|
| `oauth_passthrough_verifier: Option<String>` | 删除 |

### 3.6 `resolve_oauth`

**文件**: `apps/gateway/src/gateway.rs`

返回类型从 `(&str, Option<&OAuthConfig>)` 改为 `(&str, &OAuthConfig)`。删除 `Option` 解包逻辑。

## Phase 4: 透传相关清理

### 4.1 `upstream_request_filter`

**文件**: `apps/gateway/src/gateway.rs`

删除 `X-OAuth-Code-Verifier` 注入逻辑（lines 725-729）。

### 4.2 `handle_oauth_callback`

**文件**: `apps/gateway/src/gateway.rs`

- 删除 `client_secret.is_some()` 检查（line 652）
- 删除 passthrough 分支（lines 664-667）
- 移除 `upstream_name` 参数（不再用于 oidc_provider 判断）

### 4.3 `do_token_exchange`

**文件**: `apps/gateway/src/gateway.rs`

`client_secret` 参数不再需要额外判断（必填）。

## Phase 5: 测试更新

### 5.1 `apps/gateway/src/auth/tests.rs`

- 更新 Claims 构造（已在 ADR-006 中删除 roles/permissions/dept_ids）
- 增补 `AuthDecision` 相关测试

### 5.2 `apps/gateway/src/gateway.rs` tests

- `is_identity_header` 测试中 `x-roles`、`x-permissions` 仍应被剥离（零信任清洗不依赖业务字段是否存在）
- 无需变更（黑名单兜底设计）

## Phase 6: 配置模板更新

### 6.1 `gateway.toml`

```toml
[[upstreams]]
name = "/"
addresses = "127.0.0.1:4100"
oidc_provider = true
public_paths = [
    "/login", "/register", "/error",
    "/api/auth/", "/oauth2/", "/.well-known/",
    "/", "/_next/", "/favicon.ico",
]
[upstreams.oauth]
client_id = "portal"
client_secret = "从Portal DB clients表生成"    # ← 新增必填
callback_path = "/api/auth/callback"

[[upstreams]]
name = "/demo/"
addresses = "127.0.0.1:3100"
public_paths = ["/demo/landing"]
[upstreams.oauth]                             # ← 新增必填段
client_id = "demo"
client_secret = "从Portal DB clients表生成"
callback_path = "/api/auth/callback"
```

## 执行顺序

```
Phase 1: AuthDecision 枚举 + authenticate::check 重写
Phase 2: request_filter 精简
Phase 3: 结构体简化
Phase 4: 透传清理
Phase 5: 测试
Phase 6: 配置模板

验证: cargo clippy --all-targets --all-features -- -D warnings
      cargo fmt --all -- --check
      cargo test
```

## 预计影响文件

| 文件 | 操作 |
|------|------|
| `gateway/src/auth/mod.rs` | 新增 AuthDecision 枚举 |
| `gateway/src/authenticate.rs` | 重写 check, 删除 respond_auth_failure |
| `gateway/src/gateway.rs` | 精简 request_filter, 删除透传逻辑, 结构体变更 |
| `gateway/src/config.rs` | OAuthConfig 简化, 校验增强 |
| `gateway/src/main.rs` | 删除 oidc_provider_name 传参 |
| `gateway/src/auth/tests.rs` | 增补 AuthDecision 测试 |
| `gateway/gateway.toml` | 增加必填字段 |
| `gateway/gateway.docker.toml` | 同上 |
