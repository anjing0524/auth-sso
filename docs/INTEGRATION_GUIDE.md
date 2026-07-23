# Auth-SSO Gateway 代理模式 — 接入验证指南

基于 third-party-integration.md 的「边缘鉴权 + 全局缓存」架构。
子应用是 Gateway 后面的哑服务：不实现 OIDC、不管理 Session、不验签 JWT。
仅读 `X-User-Id` Header（Gateway 注入）+ Redis 权限查询。

## 架构回顾

```
Browser → Gateway (:19443 本地 / :443 Docker) → Portal (:4100)  [OIDC Provider + JWT 签发]
                                              → Demo App (:3100) [哑服务，读 Header + Redis]
```

## 前提条件

- Docker 运行中（PG 16 + Redis 7）
- Rust 工具链或预编译 Gateway 二进制

## 第一步：启动基础设施

```bash
docker compose up -d
docker compose ps    # 确认 postgres + redis healthy
```

## 第二步：初始化 Portal

```bash
# 推送 DB schema + 种子数据
pnpm --filter @auth-sso/portal db:push
pnpm --filter @auth-sso/portal db:seed
```

## 第三步：启动所有服务

```bash
# 终端 1: Portal (http://localhost:4100)
pnpm dev:portal

# 终端 2: Gateway (预编译二进制)
./apps/gateway/target/release/gateway -c apps/gateway/gateway.toml
# Gateway: HTTP :19080 (→ 302 HTTPS), HTTPS :19443

# 终端 3: Demo App (http://localhost:3100)
pnpm dev:demo
```

> 浏览器访问 `https://localhost:19443` 时需接受自签名证书（CN=localhost, 有效期至 2036）。

## 第四步：端到端验证

1. 浏览器访问 `https://localhost:19443/login` → Portal 登录页
2. 用 admin 账户登录 → 获得 `portal_jwt_token` Cookie
3. 访问 `https://localhost:19443` → Portal Dashboard（Gateway 验签通过）
4. 新标签页访问 `http://localhost:3100` → **注意：直接访问 Demo App 不会经过 Gateway**

### Gateway 代理模式完整验证

要验证 Gateway → Demo App 的代理链路，需在路由表（`[[upstreams]]`）中声明按路径前缀路由到 Demo App。

> **配置模型**：每个 `[[upstreams]]` 条目的 `name` 字段**同时就是路径前缀**（"name 即 prefix"），无需额外的 `path_prefixes` 字段。
> 标记 `oidc_provider = true` 的条目同时充当 JWKS 公钥刷新与 Token 续签的目标（指向 Portal）；其余条目仅参与请求转发。

编辑 `apps/gateway/gateway.toml`，在路由表中为每个后端应用声明独立的 `[[upstreams]]` 条目：

```toml
# ── 路由表：name 即 path prefix，按长度降序最长前缀匹配 ──

# Portal：根前缀 + OIDC 提供方（JWKS 刷新与 Token 续签的来源）
[[upstreams]]
name = "/"
addresses = "127.0.0.1:4100"
oidc_provider = true
public_paths = [
    "/login", "/register", "/error", "/",
    "/api/auth/", "/oauth2/", "/.well-known/",
    "/_next/", "/favicon.ico",
]

# Demo App：子前缀，独立后端
[[upstreams]]
name = "/demo/"
addresses = "127.0.0.1:3100"
public_paths = ["/demo/landing"]
```

然后：
1. 访问 `https://localhost:19443/demo/` → 走 Gateway 路由到 Demo App（:3100）
2. 查看 `X-User-Id` Header 是否存在（由 Gateway 验签后注入）
3. 确认 Redis 权限数据已缓存（`portal:user_perms:{userId}`）

> 路由匹配规则：按 `name` 长度**最长前缀优先**；未匹配任何前缀的请求 fallback 到最短前缀 upstream（通常为 `/`）。

## 验证检查清单

| # | 检查项 | 预期结果 |
|---|--------|---------|
| 1 | Gateway 启动 + JWKS 下载 | 日志: "JWKS 缓存已刷新" |
| 2 | Portal 登录 → JWT Cookie | `portal_jwt_token` HttpOnly Cookie |
| 3 | Gateway 验签 | 受保护路径返回 Portal 内容（非 302） |
| 4 | Demo App 读 X-User-Id | Header 存在，值为用户 UUID |
| 5 | Demo App 读 Redis 权限 | `portal:user_perms:{userId}` 返回角色+权限 |
| 6 | Demo App 零 OIDC | 代码中无 authorize/token/userinfo 调用 |
| 7 | Demo App 零 Session | 无自定义 Cookie 写入 |

## 子应用接入模式（标准模板）

任何接入 Auth-SSO 的子系统，只需做两件事：

```typescript
// 1. 读取 Gateway 注入的身份
const userId = request.headers.get('x-user-id');

// 2. 查询 Redis 获取权限
const perms = await redis.get(`portal:user_perms:${userId}`);
```

不需要：OIDC 库、JWT 库、Session 管理、登录页、回调接口。

## 踩坑记录

- [ ] Gateway 首次启动耗时：____ 秒（含 JWKS 下载）
- [ ] 遇到的第一个问题：____
- [ ] 解决方案：____
