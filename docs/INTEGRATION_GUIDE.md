# Auth-SSO Gateway 代理模式 — 接入验证指南

基于 [`third-party-integration.md`](spec/third-party-integration.md) 的「边缘鉴权 + 全局缓存」架构。
子应用是 Gateway 后面的哑服务：不实现 OIDC、不管理 Session、不验签 JWT。
仅读 `X-User-Id` Header（Gateway 注入）+ 自行查 Redis 权限（缓存由 Portal 写，网关不写）。

> **本文只写代码里现有的事实**。凡本文写到的端口、路径、头名、命令，都附了出处（仓库相对路径 + 符号名；
> 不写行号，见 `AGENTS.md`）。引用前请以代码为准（`docs/README.md` §三：代码与测试 > 文档）。

## 架构回顾

```
Browser → Gateway（唯一公网入口）→ Portal（OIDC Provider + JWT 签发）
                                → 其它 [[upstreams]] 后端（哑服务，读 Header + Redis）
```

端口按**目标**不同，不要混成一条链路（只有两个生产目标；验收栈不是部署方向）：

| 目标 | 配置文件 | 入口 | Portal 地址 |
|---|---|---|---|
| Docker 验收栈（非部署） | `apps/gateway/gateway.e2e.toml`（`ssl_port = 443`；只声明 `/` 一条 upstream） | 宿主 `https://127.0.0.1:19443`（`19443:443`，`docker/compose/test.yml`） | `portal:4000`（容器网络内，不映射宿主端口；`docker/compose/test.yml` 是容器内健康检查） |
| 自托管生产（P1） | `apps/gateway/gateway.docker.toml`（`docker/compose/test.yml` 只在验收栈挂 e2e 配置；`prod.yml` 的 gateway 未覆盖配置 ⇒ 镜像内 `/app/gateway.toml` = `gateway.docker.toml`） | 域名 80/443，Gateway 内建 ACME（`docker/compose/prod.yml`） | `portal:4000`（`apps/gateway/gateway.docker.toml`） |
| Vercel 平台（P2） | `apps/gateway/gateway.vercel.toml`（`external_tls_termination = true`） | 平台域名（外部 TLS 终结） | 同镜像内 `127.0.0.1:4100`（`gateway.vercel.toml`、`docker/images/vercel.Dockerfile`） |

`apps/gateway/gateway.toml` 仅作为本地 Gateway 模板保留；`pnpm dev` 只启动 Portal，不属于部署目标；
目标收敛依据见 [ADR-030](adr/ADR-030-deployment-targets.md)。

Gateway 启动时读的是**工作目录下的 `gateway.toml`**（`apps/gateway/src/main.rs`，默认值 `gateway.toml`）：
compose 通过只读挂载或镜像内置决定它到底是哪一份（`docker/compose/test.yml` 挂 `gateway.e2e.toml`；
`docker/images/gateway.Dockerfile` 的 `COPY` 步骤把 `gateway.docker.toml` 拷成 `/app/gateway.toml`）。

**两个生产目标都只有 Gateway 一个公网入口**：自托管生产 `docker/compose/prod.yml` 只发布 Gateway 的 80/443，
Portal 仅 `expose` 4000（`docker/compose/prod.yml`）；Vercel 由平台终结 TLS。

> **关于 Demo App（`apps/demo-app/`）**：它**不在任何 compose 文件里**
> （`grep -l demo-app docker/compose/*.yml` 零命中），镜像构建也不会构建它
> （`docker/images/gateway.Dockerfile` 只把 `gateway.docker.toml` 拷成 `/app/gateway.toml`）。
> 因此 `apps/gateway/gateway.docker.toml` 中 `name = "/demo/"` → `demo:3000` 的声明在 compose 栈里**没有对应服务**：
> 任何 `/demo/*` 请求会被路由到一个不存在的上游。**该声明已于 2026-10-23 从 `gateway.docker.toml` 移除**
> （避免生产形态静默 502；同一提交在文件内保留注释与恢复示例）。host 模板 `apps/gateway/gateway.toml`
> 仍保留指向 `127.0.0.1:3100` 的条目（与 `apps/demo-app/package.json` 的 `next dev -p 3100` 对得上），
> 但 host 原生启动只用于本地开发（`pnpm dev`，见 [`docs/local-development.md`](local-development.md)），demo 链路需要按下文
> 「Gateway 代理模式完整验证」自行搭三条腿。

## 前提条件

Docker 运行中即可——PostgreSQL 18 + Redis 8 + Portal + Gateway 都由 `docker/compose/test.yml` 提供
（`docker/compose/test.yml` 的 postgres/redis/portal/gateway），与 CI / 生产同形态
（本地原生 `pnpm dev` 只用于开发，验收入口仍是 Docker；见 [`docs/local-development.md`](local-development.md)）。

## 第一步：构建并启动验收栈

```bash
export COMPOSE="docker compose -f docker/compose/test.yml"
$COMPOSE build
$COMPOSE up -d --wait --wait-timeout 600
$COMPOSE ps
```

服务列表固定为 `postgres redis cert-init db-init portal gateway`；超时 600s。

> 一次性服务 `cert-init` / `db-init` 显示 `Exited (0)` 是正常的：它们各自完成"生成自签证书"
> 与"迁移 + 种子数据"后退出（`docker/compose/test.yml`），`up --wait` 会正确放行。

## 第二步：确认初始化数据

`db-init` 已自动执行 migrate + seed（`docker/compose/test.yml` 的 `pnpm --filter @auth-sso/portal db:migrate && pnpm --filter @auth-sso/portal db:seed`）；如需在**有数据库连接**的环境里单独操作：

```bash
pnpm --filter @auth-sso/portal db:migrate
pnpm --filter @auth-sso/portal db:seed
```

> 种子密码 `Admin@123456`、邮箱 `admin@example.com` 来自 `apps/portal/scripts/seed.ts`（管理员种子的 bcrypt 哈希与 email 行）；
> e2e 也用同一组（`tests/e2e/docker-release.spec.ts`）。

## 第三步：浏览器验证

打开 **https://127.0.0.1:19443/login**（Gateway 唯一入口，`cert-init` 生成的自签证书，SAN 仅 `IP:127.0.0.1` + `DNS:localhost`，`docker/compose/test.yml`，用 `curl -k` / `ignoreHTTPSErrors`）：

1. 用 `admin@example.com` / `Admin@123456` 登录 → OAuth 回调后 Gateway 下发 `portal_jwt_token` + `portal_refresh_token` 两个 HttpOnly/Secure/SameSite=Lax Cookie（`apps/gateway/src/cookie.rs`；下发在 `apps/gateway/src/oauth.rs`；e2e 断言 `tests/e2e/docker-release.spec.ts`）；
2. 访问 `https://127.0.0.1:19443/dashboard` → Portal Dashboard（Gateway 验签通过后转发；e2e 断言 `tests/e2e/docker-release.spec.ts`）；
3. 未认证直接访问 `/dashboard` → 302 到 `/login?session_id=...`（`tests/e2e/docker-release.spec.ts`）。

> Portal 容器端口 4000 只在 compose 网络内，不对宿主暴露（`test.yml` 的 `portal` 服务无 `ports:`，只有 `docker/compose/test.yml` 的容器内健康检查）；
> 浏览器入口只有 Gateway。本地 `pnpm dev` 直连 4100 仅用于 UI 开发；验收入口不绕过 Gateway。

### OIDC 机器端点怎么走（2026-10-23 更正，ADR-010 更正段）

`/.well-known/openid-configuration` 由 Portal 生成但经 Gateway 转发，`issuer` 与四个机器
端点（token/introspect/revoke/userinfo）都声明在**Gateway 入口 URL** 下——因此标准 OIDC
客户端是**经 Gateway** 访问这些端点的，不是"直连 Portal"。为此：

- Gateway 在 **Public 路径**（`/api/auth/*`、`/.well-known/*` 等白名单）**保留客户端自带的
  `Authorization`**（Basic 客户端凭证 / userinfo 的 Bearer）；
- 在 Protected/Microservice 路径仍执行"剥离客户端身份头 → 按验签结果权威注入"，
  身份头伪造依旧被清洗；
- Portal 对 Public 路径的 Bearer 走自验签（签名 + iss/aud/typ + jti 黑名单 fail-close），
  登出后的旧 AT 会被拒（不会因"走 Public"而绕过撤销）。

排障要点：

| 现象 | 期望/检查 |
|---|---|
| `token` + Basic 假 code | **400 `invalid_grant`**（若见 401 `invalid_client` 且文案"缺少 client_id"，说明 Gateway 仍剥离 Authorization——旧镜像/未修复） |
| `userinfo` + 真实 Bearer | 200；登出后再试 → 401 `invalid_token` |
| `POST /api/permissions/register` + Basic | **401**。该端点是 Portal 内网机器接口，不在 Gateway 白名单，经公网入口不可达（预期） |
| `/_next/../api/users` 等 dot-segment 路径 | **400**（Gateway 入口拒绝；不能再用它绕过限流/验签） |


## 第四步：端到端验收

```bash
pnpm test:e2e
```

`pnpm test:e2e` == `./scripts/e2e/release.sh`：直接构建并拉起 `docker/compose/test.yml` 的
`postgres`/`redis`/`cert-init`/`db-init`/`portal`/`gateway`，再用 Playwright 跑 `tests/e2e` 全部 spec：
登录 → OAuth 回调 → 会话下发 → 登出、OIDC 机器端点凭证透传、SSR 权限快照 / `/healthz` 探针，
跑完自动 `docker compose -f docker/compose/test.yml down --volumes --remove-orphans`。

想保留现场继续手动看 UI：

```bash
E2E_KEEP_STACK=1 pnpm test:e2e   # 保留栈，不执行退出清理（`scripts/e2e/release.sh` 的 `E2E_KEEP_STACK` 分支）
SKIP_BUILD=1 pnpm test:e2e       # 复用已构建镜像（`scripts/e2e/release.sh` 的 `SKIP_BUILD` 分支）
docker compose -f docker/compose/test.yml down --volumes --remove-orphans                  # 看完清理
```

### Gateway 代理模式完整验证

要验证 Gateway → 其它后端的代理链路，需在路由表（`[[upstreams]]`）中声明按路径前缀路由到该后端。

> **配置模型**：每个 `[[upstreams]]` 条目的 `name` 字段**同时就是路径前缀**（"name 即 prefix"，
> `apps/gateway/src/router.rs` 的 `RouteEntry.prefix`），没有额外的 `path_prefixes` 字段。
> 标记 `oidc_provider = true` 的条目是 OIDC Provider 上游（`apps/gateway/src/main.rs` 取其 upstream 构造
> JWKS 刷新与 Token 续签目标；启动期只校验「**至少有一条**」，`find` 取第一条，`apps/gateway/src/config.rs`）；OAuth 凭据本身已于 ADR-010 二期收敛到网关级 `[gateway.oauth]`，
> 不随路由携带。

路由表长这样（`apps/gateway/gateway.toml`，**Gateway 启动时读取的是工作目录下的 `gateway.toml`**，
容器里由 Dockerfile 把 `gateway.docker.toml` 拷成 `/app/gateway.toml`，见 `docker/images/gateway.Dockerfile`）：

```toml
# ── 路由表：name 即 path prefix，按长度降序最长前缀匹配 ──

# Portal：根前缀 + OIDC 提供方（JWKS 刷新与 Token 续签的来源）
[[upstreams]]
name = "/"
addresses = "127.0.0.1:4100"
oidc_provider = true
public_paths = [
    "/login", "/register", "/error", "/oauth/error",
    "/api/auth/", "/oauth2/", "/.well-known/",
    "/", "/_next/", "/favicon.ico",
]

# Demo App：子前缀，独立后端
[[upstreams]]
name = "/demo/"
addresses = "127.0.0.1:3100"
public_paths = ["/demo/landing"]
```

不同目标的同一段路由表**地址不同**，别照抄：验收/自托管生产是 `portal:4000`（`gateway.docker.toml`、`gateway.e2e.toml`），
Vercel 平台是 `127.0.0.1:4100`（`gateway.vercel.toml`）。

> **注意**：上表中 `127.0.0.1:3100` 的 `/demo/` 条目指向的 Demo App **不在任何 compose 文件里**（见文首说明），
> 因此在 `docker compose -f docker/compose/test.yml up -d --wait --wait-timeout 600` 起的验收栈里 `/demo/` 路由**无可用节点**，访问会得到 502；
> 要重建这条链路，需要同时满足三件事：在 host 上起 `apps/demo-app`（`pnpm --filter @auth-sso/demo-app dev`，端口 3100，见 `apps/demo-app/package.json`）、
> 让它的 `REDIS_URL`（`apps/demo-app/src/lib/permissions.ts`）指向与 Portal 相同的 Redis、并在 host 上以
> `apps/gateway/gateway.toml` 起 Gateway 进程——而 host 进程入口已不在交付路径内（[`docs/docker.md`](docker.md) §7.5）。

验证一条受保护路径上的身份注入，看 Gateway 实际写入的请求头（头名常量 `apps/gateway/src/gateway.rs`）：

| 头名 | 何时注入 | 值 |
|---|---|---|
| `X-User-Id` | 仅在**验签通过**（`ctx.identity` 非空）时 | JWT `sub`（`apps/gateway/src/gateway.rs`） |
| `X-User-Jti` | 同上 | JWT `jti`（同上） |
| `Authorization` | 同上 | `Bearer <AT>`（由 Gateway 用自己的 AT 覆盖，`apps/gateway/src/gateway.rs`） |
| `X-Gateway-Timestamp` / `X-Gateway-Signature` | 配置了 `gateway_shared_secret` 且验签通过 | HMAC-SHA256(`timestamp:userId:jti`)（`apps/gateway/src/gateway.rs`；Portal 校验见 `apps/portal/src/lib/auth/verify-jwt.ts`） |

**Public 路径（`public_paths` 白名单）一个身份头都不注入**：`request_filter` 在 `PathClass::Public` 直接放行
（`apps/gateway/src/gateway.rs`），`ctx.identity` 保持为空，故上面四个头都不会出现；同时 Public 路径**保留**客户端自带的
`Authorization`（`apps/gateway/src/gateway.rs` 的 `strip_identity_headers`，`keep_authorization = path_class == PathClass::Public`）。
这也是 `x-user-name` 至今是「已声明无消费者」头的原因（`packages/contracts/src/index.ts`）。

> 路由匹配规则：`Router::resolve_idx` 按 `name` 长度**降序**排好序后取**第一个** `path.starts_with(prefix)` 的条目
> （最长前缀优先）；一个前缀都不匹配时**兜底取末条目**（最短前缀，通常为 `/`），见 `apps/gateway/src/router.rs`。

### ⚠️ 权限缓存（`portal:user_perms:*`）：Gateway 不写、也不读

**这是本指南最容易写错的一处，按代码现状如实说明：**

- **Gateway 不缓存、不注入任何权限**。它只注入上表四个身份头；`apps/gateway/src` 全仓 grep `user_perms` **零命中**，
  网关的 Redis 模块只有 `exists` / `acquire_nx_ex` / `del`（`apps/gateway/src/redis.rs`），
  即 jti 黑名单/去重那一类操作，没有任何权限读取或写入。这是 ADR-006 / ADR-007 的既定设计
  （「Gateway 只做身份断言注入，不做任何权限相关操作」），不是缺失实现。
- **写这个缓存的是 Portal**，键前缀来自 `REDIS_KEY_PREFIX.USER_PERMS = 'portal:user_perms:'`
  （`packages/contracts/src/oidc.ts`），实现集中在 `apps/portal/src/lib/permissions.ts`：
  - `cacheUserPermissionContext()`（`apps/portal/src/lib/permissions.ts`）负责写入，TTL = 3600s ±300s 抖动（`apps/portal/src/lib/permissions.ts` 的 `PERM_CACHE_TTL_BASE` / `PERM_CACHE_TTL_JITTER`）；
  - 调用点是**签发路径**：授权码兑换（`apps/portal/src/lib/auth/oauth-grant.ts`）与 RT 轮换
    （`apps/portal/src/lib/auth/token.ts`）都经 `resolveIssuancePermission()`（`apps/portal/src/lib/permissions.ts`）预填充；
    管理员重置密码后还会 `refreshUserPermissionCache()`（`apps/portal/src/app/api/users/[id]/reset-password/route.ts`）。
  - 语义分级见 ADR-011 / ADR-018：用户不存在/非 ACTIVE → 拒绝签发；DB 故障 → **照常签发但跳过预填充**
    （`apps/portal/src/lib/permissions.ts`），此时缓存里没有该用户的键，`GET` 得到空。
- **读方**是子应用自己（ADR-007 子应用自取模式），仓库内的参考实现在 `apps/demo-app/src/lib/permissions.ts`：
  `r.get('portal:user_perms:' + userId)`，value 形如 `{ roles, permissions, deptIds }`（`apps/demo-app/src/lib/permissions.ts`）。

因此「登录后缓存必定存在」**不是**可依赖的保证；子应用必须把「缓存查不到」当成一种正常状态处理（demo 的写法是
显示"Redis 中无权限缓存"提示，`apps/demo-app/src/app/page.tsx`），而不是假设它一定被预热。

## 验证检查清单

> `https://127.0.0.1:19443` 的本地/发布 E2E 证书是仅含 loopback SAN 的临时自签证书（`docker/compose/test.yml`）。
> 生产环境不复用该证书，统一由 Gateway 的 Rust 内建 ACME 客户端签发和续期 Let's Encrypt 证书（`docker/compose/prod.yml`），详见 [`docs/docker.md`](docker.md) §0–§6。

| # | 检查项 | 预期结果（出处） |
|---|--------|---------|
| 1 | Gateway 启动 + JWKS 下载 | 日志含 `JWKS 公钥缓存刷新成功`（`apps/gateway/src/jwks.rs`）；启动首刷成功还会打印 `首次 JWKS 缓存刷新成功，开始接受流量`（`apps/gateway/src/jwks.rs`） |
| 2 | Portal 登录 → JWT Cookie | `portal_jwt_token` + `portal_refresh_token`，HttpOnly / Secure / SameSite=Lax（`apps/gateway/src/cookie.rs`、`apps/gateway/src/oauth.rs`） |
| 3 | Gateway 验签 | 受保护路径返回 Portal 内容（非 302） |
| 4 | Gateway 注入身份头 | 受保护路径上有 `X-User-Id`，值为用户 UUID；同请求还应有 `X-User-Jti`（`apps/gateway/src/gateway.rs`） |
| 5 | 权限缓存由 Portal 写、子应用读 | `portal:user_perms:{userId}` 由 Portal 在签发时预填充（`apps/portal/src/lib/permissions.ts` 的 `resolveIssuancePermission`）；**Gateway 不参与**，见上一节 |
| 6 | Demo App 零 OIDC | 代码中无 authorize/token/userinfo 调用（`apps/demo-app/src/` 全文核实） |
| 7 | Demo App 零 Session | 无自定义 Cookie 写入（`apps/demo-app/src/` 全文核实）；注意它会**读** `x-user-id` / `authorization` 请求头（`apps/demo-app/src/app/page.tsx`） |

## 子应用接入模式（标准模板）

任何接入 Auth-SSO 的子系统，只需做两件事（参考实现：`apps/demo-app/src/app/page.tsx` + `apps/demo-app/src/lib/permissions.ts`）：

```typescript
// 1. 读取 Gateway 注入的身份（未登录/Public 路径下可能为空，必须处理）
const userId = request.headers.get('x-user-id');

// 2. 自己查 Redis 拿权限（缓存可能为空 —— 它不是"登录必有"的保证）
const perms = await redis.get(`portal:user_perms:${userId}`);
```

不需要：OIDC 库、JWT 库、Session 管理、登录页、回调接口。

> **不要校验 `X-User-Id` 的"签名"**：Gateway 额外下发的 `X-Gateway-Signature` / `X-Gateway-Timestamp` 是
> **Gateway→Portal** 这一跳的 HMAC（`apps/gateway/src/gateway.rs`，Portal 侧校验在 `apps/portal/src/lib/auth/verify-jwt.ts`），
> 子应用既不持有共享密钥、也不在信任链上；子应用能信任身份的前提是「请求确实由 Gateway 注入」，
> 即子应用端口不对本机以外的调用方直开（拓扑层面保证，见文首「只有 Gateway 一个公网入口」）。

> **`deptIds` 口径提醒（ADR-002 增补 / 决策 D1）**：`portal:user_perms:{userId}` 里的
> `deptIds` 是用户角色的 `roles.dept_id` **原始值，未展开子树**。如果子应用要按部门做数据范围，
> 必须自行展开子树（按 `departments.ancestors` 逐段匹配）或改为调用 Portal 授权接口；
> 不能把它直接当作"可见部门集合"，否则会漏掉子部门数据（fail-closed）。Portal 内部唯一展开实现
> 是 `lib/authz/data-scope.ts` 的 `resolveScope()`。

