# ADR-009: Gateway 认证流统一与结构精简

| 属性       | 值                                    |
|------------|---------------------------------------|
| **状态**   | accepted                              |
| **日期**   | 2026-07-16                            |
| **决策者** | Auth-SSO 团队                         |
| **影响范围** | Gateway (Rust) — request_filter、authenticate::check、config、GatewayCtx |

## 背景

当前 Gateway 的 `request_filter`（~90 行）含有 3 个独立的认证决策点，圈复杂度 CC≈12：

1. **step 5** — OAuth callback 拦截：区分 `oidc_provider` vs 普通 upstream、`client_secret` 存在 vs 透传
2. **step 7** — 无 JWT 时：区分 HTML nav（PKCE 302）vs API（401）
3. **step 8** — `authenticate::check`：JWT 验签 + RT 续签，失败时 HTML nav → 透传 Portal

这三个决策点中存在重复：`is_html_nav` 判断在 step 7 和 step 8（`respond_auth_failure`）各出现一次；`oauth_config` 的存在性在 step 5 和 step 7 各判断一次；认证失败时的响应（PKCE 302 / 401 / 透传）在三个点中行为不一致。

此外，`respond_auth_failure` 中 HTML 透传分支的注释（"proxy.ts 需要在跳转 /authorize 之前生成 PKCE"）已过时——Gateway 自身已在 `oauth_authorize_redirect` 中实现完整的 PKCE 生成与 302 跳转。

## 决策

### 1. 认证决策收敛：`AuthDecision` 枚举

`authenticate::check` 的返回值从 `Result<bool>` 改为 `Result<AuthDecision>`：

```rust
pub enum AuthDecision {
    /// 认证通过，继续代理
    Pass,
    /// 已发送 401 响应，请求终止
    Interrupted,
    /// HTML 页面导航但无法恢复有效身份 → 需要 PKCE 跳转
    PkceRequired,
}
```

`request_filter` 中**唯一的认证决策点**：

```rust
match authenticate::check(session, ctx, verifier, refresher, is_html_nav).await? {
    AuthDecision::Pass         => Ok(false),
    AuthDecision::Interrupted  => Ok(true),
    AuthDecision::PkceRequired => self.oauth_authorize_redirect(session, oauth, &path).await,
}
```

这消除了旧 step 7 的独立 `hasJwt` 判断——无 AT Cookie 只是 `authenticate::check` 中认证失败的一种情况，统一返回 `PkceRequired`。

### 2. OAuth 配置强制必填

`OAuthConfig` 对所有 upstream 变成必填（`Option<OAuthConfig>` → `OAuthConfig`）。`client_secret` 从 `Option<String>` 变为 `String`（必填）。

这意味着：
- 所有 SSO 子应用的 Token 交换均由 Gateway 代劳（`do_token_exchange`）
- callback 透传模式（`X-OAuth-Code-Verifier` header 注入）删除
- Portal 自身也配置 `client_secret`，与其他 upstream 统一走 Gateway callback 拦截

### 3. 删除 `oidc_provider_name` 及相关跳过逻辑

`oidc_provider` 标记保留其原始用途（标识 JWKS/OIDC Discovery 目标），但 `oidc_provider_name` 字段（用于跳过 Portal callback 拦截）删除。所有 upstream 的 callback 拦截行为统一。

### 4. 删除 `respond_auth_failure`

该函数的 HTML 透传逻辑已过时，PKCE 302 能力由 Gateway 自身提供。其逻辑迁入 `authenticate::check`（返回 `PkceRequired` / `Interrupted`）。

### 5. `authenticate::check` 内部用 `match` 替代 `matches!`

```rust
match expiry {
    TokenExpiry::Valid => Ok(AuthDecision::Pass),
    TokenExpiry::NearlyExpired => {
        let _ = try_refresh(cookie_header, ctx, refresher).await;
        Ok(AuthDecision::Pass)
    }
    TokenExpiry::Expired => {
        if try_refresh(cookie_header, ctx, refresher).await {
            Ok(AuthDecision::Pass)
        } else if is_html_nav {
            Ok(AuthDecision::PkceRequired)
        } else {
            session.respond_401().await?;
            Ok(AuthDecision::Interrupted)
        }
    }
}
```

编译器强制穷尽，新增 `TokenExpiry` 变体时编译报错。

## 后果

### 正面

- 认证决策点从 3 个收敛为 1 个
- `request_filter` 圈复杂度从 CC≈12 降至 CC≈4（Static / Rate / Callback / Auth）
- 删除约 60 行死代码/过时逻辑
- `GatewayCtx` 删除 1 个死字段（`oauth_passthrough_verifier`）
- `OAuthConfig` 简化（去掉两层 `Option` 嵌套）
- 所有 upstream 的 OAuth 行为一致，无特殊分支

### 需承担

- Portal 需要在 DB `clients` 表中为 `client_id = "portal"` 生成 `client_secret`
- `gateway.toml` 中所有 `[[upstreams]]` 必须配置 `[upstreams.oauth]` 段（含 `client_secret`）
- 第三方子应用接入 Gateway 时必须先在 Portal 注册 Client 并获取 secret

## 删除清单

| 删除项 | 位置 | 原因 |
|--------|------|------|
| `respond_auth_failure` | `authenticate.rs` | 逻辑迁入 `check` |
| `request_filter` step 7（~37行） | `gateway.rs` | 与 `authenticate::check` 的 `PkceRequired` 重复 |
| `GatewayCtx.oauth_passthrough_verifier` | `gateway.rs` | 透传模式删除 |
| `X-OAuth-Code-Verifier` 注入 | `upstream_request_filter` | 透传模式删除 |
| `Gateway.oidc_provider_name` | `gateway.rs` | callback 跳过逻辑删除 |
| Callback 中 `oidc_provider_name` 跳过判断 | `request_filter` | 统一处理 |
| Callback 中 `client_secret.is_some()` 分支 | `handle_oauth_callback` | 必填后唯一路径 |
| `OAuthConfig.client_secret: Option<String>` | `config.rs` | 改为 `String` |
| `resolve_oauth` 返回 `Option<&OAuthConfig>` | `gateway.rs` | 改为 `&OAuthConfig` |

## 相关 ADR

- ADR-003: Gateway 作为 OAuth Client
- ADR-005: 三层安全模型
- ADR-006: JWT 最小化 — 身份断言与鉴权数据分离
- ADR-007: 子应用自取权限 — Gateway 不管鉴权
