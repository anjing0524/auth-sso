# ADR-003: Gateway 作为统一 OAuth 2.1 Client

| 属性       | 值                                    |
|------------|---------------------------------------|
| **状态**   | implemented (2026-07-16, ADR-009 增强)|
| **日期**   | 2026-07-15                            |
| **决策者** | Auth-SSO 团队                         |
| **影响范围** | Gateway（Rust）、Portal（OIDC Provider）、第三方应用接入 |

## 背景

Auth-SSO 面向两类使用者：
- **Portal 自身**：管理门户，用户通过浏览器直接登录
- **第三方子应用**：Demo App 等业务系统，通过 OAuth 2.1 接入 SSO

第三方子应用接入 SSO 需要完成完整的 PKCE 流程：生成 code_verifier → 计算 challenge → 管理 state/nonce → 拦截 callback → 换 token → 管理 session cookie。如果每个子应用都自行实现这套逻辑，接入成本极高。

## 决策

**Gateway 统一承担 OAuth 2.1 Client 角色，为所有下游子应用提供开箱即用的 SSO 接入。**

架构位置：

```text
Browser → Gateway (TLS终结 + OAuth Client) → Portal (OIDC Provider)
                ↓                                    ↓
          子应用 (只需验证 x-user-id)           签发 JWT + 管理 Client
```

Gateway 负责：
1. **PKCE 生成**：CSPRNG 生成 code_verifier（32 字节）
2. **OAuth Cookie 下发**：`pkce_verifier`、`oauth_state`、`oauth_nonce`、`return_to`（HttpOnly + Secure + SameSite=Lax + Path=/api/auth/callback + Max-Age=300s）
3. **302 跳转**：`/oauth2/authorize?client_id=...&code_challenge=...&state=...`
4. **Callback 拦截**：校验 state → 取 verifier → POST `/oauth2/token` → 校验 nonce
5. **Session Cookie 下发**：`portal_jwt_token` + `portal_refresh_token`

子应用**只需做两件事**：
1. 信任 Gateway 注入的 `x-user-id`、`x-user-name`、`x-user-jti` 头
2. 可选：校验 `X-Gateway-Signature` HMAC 签名确认请求经过 Gateway

## 后果

- **降低接入负担**：子应用不需要理解 OAuth 2.1 协议细节
- **Gateway 不再是"纯代理"**：它是一个有应用逻辑的边缘服务
- **新增 OAuth Client** 需要修改 Gateway 配置（`upstreams[].oauth` 段）并重启
- **调试复杂度**：OAuth 流程跨 Rust（PKCE）→ TS（OIDC Provider）两个语言栈，出问题需同时排查

## 接口契约

| 组件 | 角色 | 关键输出 |
|------|------|----------|
| Gateway | OAuth Client | PKCE 生成、state/nonce 管理、Cookie 生命周期 |
| Portal BFF | OIDC Provider (AS) | `/authorize`、`/token`、`/userinfo`、JWKS |
| 子应用 | Resource Server | 读取 `x-user-id`，可选校验 HMAC |

## 相关 ADR

- ADR-004: 无状态 JWT + Redis jti 黑名单
- ADR-005: 三层安全模型（Gateway 属于第一层）

## 验证（2026-10-16 补：活体核实）

| 断言 | 证据（file:line） | 判定 |
|---|---|---|
| 四个 OAuth cookie 名为 `pkce_verifier` / `oauth_state` / `oauth_nonce` / `return_to` | `apps/gateway/src/contract_tests.rs:48` / `:52` / `:56` / `:58` —— **对着跨语言契约文件**逐个断言（`at(&f, "cookies.pkce_verifier")` 等）⇒ 名字由**契约测试**锁住 | 真 |
| Callback 路径 `/api/auth/callback` | `apps/gateway/src/jwks.rs:24` = `DEFAULT_CALLBACK_PATH: &str = "/api/auth/callback"`（并由 discovery 的自定义字段驱动） | 真 |
| Cookie 属性 HttpOnly + Secure + SameSite=Lax + Max-Age | `apps/gateway/src/cookie.rs:165` 生成串含 `Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600` | 真 |
| PKCE：CSPRNG 生成 **32 字节** code_verifier | `apps/gateway/src/oauth.rs:83-86` = "生成 PKCE code_verifier（**43 字符**，RFC 7636 §4.1 的 43–128 区间）…… **32 字节（256 bit）** 经 base64url 得 43 字符…… 与 Portal `generateCodeVerifier()`（32 字节 `crypto.getRandomValues` → base64url）一致" | 真 |
| 两条流程（无 JWT 导航 → 302 `/authorize`；callback → 取 verifier → POST `/token` → 下发 token） | `apps/gateway/src/oauth.rs:4-5` 模块头逐条写明 | 真 |

**一个正面对照**：本 ADR 的 cookie 名**无需补守卫** —— `contract_tests.rs` 已经在用跨语言契约文件
逐个断言（与 ADR-008 的权限码"当时只有取值、没有校验器"形成对照）。这说明"**声明是否有阻断点**"
应当逐条核，而不能按"这份 ADR 看起来有测试"整体推断。
