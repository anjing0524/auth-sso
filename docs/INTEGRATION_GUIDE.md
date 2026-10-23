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

Docker 运行中即可——PG 16 + Redis 7 + Portal + Gateway 都由 `docker/compose.test.yml` 提供，
与 CI / 生产同形态（host `pnpm dev` 入口已移除，原因见 `docker/README.md` §7.5）。

## 第一步：构建并启动验收栈

```bash
pnpm stack:build     # 构建 portal / gateway / cert-init / db-init 镜像
pnpm stack:up        # 起栈并等待健康（timeout 600s）
pnpm stack:status    # 确认全部 healthy
```

> 一次性服务 `cert-init` / `db-init` 显示 `Exited (0)` 是正常的：它们各自完成"生成自签证书"
> 与"迁移 + 种子数据"后退出，`up --wait` 会正确放行。

## 第二步：确认初始化数据

`db-init` 已自动执行 migrate + seed；如需在本机对开发库单独操作：

```bash
pnpm db:migrate   # 等价 pnpm --filter @auth-sso/portal db:migrate
pnpm db:seed      # 种子账号 admin@example.com / Admin@123456
```

## 第三步：浏览器验证

打开 **https://127.0.0.1:19443/login**（Gateway 统一入口，自签证书）：

1. 用 `admin@example.com` / `Admin@123456` 登录 → 获得 `portal_jwt_token` Cookie；
2. 访问 `https://127.0.0.1:19443/` → Portal Dashboard（Gateway 验签通过）；
3. 未认证直接访问受保护路径 → 被重定向到登录页。

> Portal 容器端口 4000 只在 compose 网络内，不对宿主暴露；浏览器入口只有 Gateway。
> 直连 Portal 的"调试路径"已随 host dev 一起移除，避免把绕过 Gateway 的路径当成交付拓扑。

## 第四步：端到端验收

```bash
pnpm test:e2e
```

该命令会构建镜像、拉起 `docker/compose.test.yml` 的发布拓扑
（`postgres`/`redis`/`cert-init`/`db-init`/`portal`/`gateway`），执行经 Gateway 的浏览器闭环
（登录 → OAuth 回调 → 会话下发 → 登出），跑完自动清理。

想保留现场继续手动看 UI：

```bash
E2E_KEEP_STACK=1 pnpm test:e2e
# 或 pnpm stack:up 后单独跑 pnpm test:e2e:release
pnpm stack:down      # 看完清理
```

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

> `https://localhost:19443` 的本地/发布 E2E 证书是仅含 loopback SAN 的临时自签证书。生产环境不复用该证书，统一由 `docker/compose.prod.yml` 中 Gateway 的 Rust 内建 ACME 客户端签发和续期 Let's Encrypt 证书，详见根目录 `docker/README.md`。

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
