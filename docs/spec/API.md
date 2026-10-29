# Auth-SSO API 接口规范

**版本：** v2.2
**状态：** 正式发布
**最后更新：** 2026-10-23
**变更：** v2.2 — 按现存 `route.ts` 重新校准端点清单（新增 `GET /api/permissions/:id/impact`、
`GET /api/health`、`POST /api/auth/oauth2/revoke` 的 hint 语义、`PUT /api/roles/:id/permissions` 等）；
机器端点经 Gateway 的 `Authorization` 语义、OIDC Discovery 全字段、per-client TTL（ADR-024）、
邮箱规范化（ADR-026）、错误码附录与状态码口径对齐代码；修正无源码依据的断言与失效的路径引用。
v2.1 — 权限码统一 `portal:` 前缀（ADR-008）、响应格式澄清、Gateway callback 行为更新（ADR-009）

---

## 1. 全局约定

### 1.1 基础 URL

| 环境 | Base URL |
|------|---------|
| 本地开发 | `http://localhost:4100`（Portal 直连；**host 进程入口已移除**，仅用于容器内探针，见 AGENTS.md） |
| Docker（验收栈） | 唯一入口 `https://127.0.0.1:19443`（Gateway，自签证书） |
| Docker（Compose 内网） | `http://portal:4000`（仅供 Gateway / 容器内探针） |
| 生产环境 | `https://<your-domain>`（经 Gateway HTTPS；`docker/compose/prod.yml` 只发布 Gateway 的 80/443，Portal 无宿主端口） |

> `issuer` 与 discovery 的网络位置都是 Gateway 入口（ADR-010 更正段 / ADR-012 增补 §2）：
> `issuer = getIssuer()`（`PORTAL_ISSUER` 优先，默认 `NEXT_PUBLIC_APP_URL`），
> discovery 里声明的四个机器端点也都拼在该入口 URL 上。

### 1.2 认证方式

| 端点类别 | 认证方式 |
|---------|---------|
| 管理 API（`/api/users`、`/api/roles` 等） | Cookie `portal_jwt_token`（HttpOnly）或 `Authorization: Bearer <JWT>` |
| OIDC Provider（`/api/auth/oauth2/*`） | OAuth 2.1 客户端认证（`client_id` + `client_secret`；`client_secret_basic` 或 `client_secret_post`，两者并存以 Basic 为准、不一致拒绝） |
| 公开端点（`/api/auth/login`、`/api/auth/jwks`、`/api/health`、`/.well-known/*`） | 无需认证 |
| `/api/me` 系列 | Cookie `portal_jwt_token` 或 `Authorization: Bearer <JWT>` |
| `/api/permissions/register` | **有 Client 凭证即可**（HTTP Basic：`client_id:client_secret`）；经 Gateway 公网入口不可达（`/api/permissions/` 不在 `public_paths`，网关**剥离**客户端 `Authorization` 后按 Protected 路径判无会话 → 401）。不是给外部系统调用的公开端点，详见 §7.6 |

> **机器端点经 Gateway 的 `Authorization` 语义（2026-10-23 更正）**：Gateway 在
> **Protected/Microservice/Static** 路径会剥离客户端身份头并按验签结果注入；
> 在 **Public 路径**（`/api/auth/*`、`/.well-known/*` 等白名单）**保留客户端自带的
> `Authorization`**（否则标准 Basic 客户端与 userinfo Bearer 经唯一入口全断）。
> Public 白名单的确切集合见 §15（`apps/gateway/gateway.e2e.toml` / `gateway.docker.toml`
> 的 `[[upstreams]].public_paths`）。详见 ADR-010 更正段与 §11。


### 1.2.1 请求体解析与参数白名单（2026-10-23 补充）

- 声明为 JSON 的端点：malformed JSON / 非对象 body 一律 **400 `VALIDATION_ERROR`**（不再落 500）。
  实现示例：`/api/auth/login`、`/api/users/[id]/reset-password`、`/api/clients/[id]/tokens`。
- 列表过滤参数先做**白名单校验**再进 SQL：非法枚举（如 `?status=BOGUS`、`?type=BOGUS`）
  返回 400；非法 UUID（如 `?deptId=not-a-uuid`）返回 400——不得下沉成 PG `22P02` 的 500。


### 1.3 响应格式

Portal 存在两种不同的调用协议：

**REST HTTP 端点（`route.ts`）**：HTTP 状态码即成功/失败语义，响应体不额外包裹 `success` 字段
（唯一工厂 `apps/portal/src/lib/response.ts` 的 `restSuccess` / `restListSuccess` / `restError`）。

| 场景 | HTTP 状态 | 响应体 |
|------|-----------|--------|
| 列表查询成功 | 200 | `{ "data": [...], "pagination": { "page", "pageSize", "total", "totalPages" } }` |
| 详情查询成功 | 200 | 数据对象直出（如 `{ "id": "...", "name": "..." }`） |
| 操作成功 | 200 | 数据对象直出，或 `{ "message": "...", "data": {...} }`（如 §9.7 DELETE） |
| 参数校验失败 | 400 | `{ "error": "AUTH_SSO_1005", "message": "..." }` |
| 未认证 | 401 | `{ "error": "AUTH_SSO_1002", "message": "..." }` |
| 无权限 | 403 | `{ "error": "AUTH_SSO_1003", "message": "..." }` |
| 资源不存在 | 404 | `{ "error": "AUTH_SSO_1004", "message": "..." }` |
| 冲突/重复 | 409 | `{ "error": "AUTH_SSO_3003", "message": "..." }`（**实体专属** `*_ALREADY_EXISTS` 码，如 3003=用户名已存在） |
| 领域规则违反 / 数据形态不合法 | 422 | `{ "error": "AUTH_SSO_1005", "message": "..." }`（`BusinessRuleViolationError`） |
| 服务器错误 | 500 | `{ "error": "AUTH_SSO_1006", "message": "..." }` |

> **REST 端点没有 201**（2026-10-23 核对）：所有 `route.ts` 的写操作只有 §1.5.1 列出的
> `POST`/`PUT`/`DELETE`，全部经 `restSuccess` 返回 **200 或 422/400**；`restSuccess(data, status)`
> 的 `status` 形参保留但无调用方传 201。此前本节写的"创建成功 201"在任何 `route.ts` 里都找不到
> 对应实现——创建类写操作全部是 Server Action。
>
> **`AUTH_SSO_1005`（`VALIDATION_ERROR`）是通用码**：HTTP 状态由**错误类**决定，而状态码是
> `DomainError` 的实例字段（`apps/portal/src/domain/shared/errors.ts`），不按类名反查表
> （生产构建压缩类名会让查表全部落空）。取值：参数校验 `400`、领域规则违反 `422`、
> 唯一约束违例落到实体专属 `*_ALREADY_EXISTS` 码并返回 `409`、未登记的表/列组合回落
> `AUTH_SSO_1005` + `409`。守卫：`apps/portal/__tests__/api/error-status-guard.test.ts`
> （断言 `mapDomainError` 读 `err.status`、且每个 `DomainError` 子类在 `super()` 第三参数显式声明状态码）。

**Server Actions（RPC 调用）**：无 HTTP 协议层，通过 `success` 字段承载语义。


```json
// 成功
{ "success": true, "data": {...}, "message": "操作描述" }
// 失败
{ "success": false, "error": "AUTH_SSO_3002", "message": "错误描述" }
```

**OAuth2 端点**：遵循 RFC 6749/7662/7009 标准格式，不参与此规范。

### 1.4 分页约定

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `page` | number | 1 | 页码（从 1 开始） |
| `pageSize` | number | 20 | 每页条数 |
| `keyword` | string | — | 搜索关键词 |
| `status` | string | — | 状态过滤（ACTIVE/DISABLED/LOCKED/DELETED） |
| `deptId` | string | — | 部门过滤 |

### 1.5 REST API vs Server Action

本系统采用 Next.js App Router 架构，API 面分为两类：

| 类型 | 路径 | 用途 | 外部可调用 |
|------|------|------|-----------|
| **REST API** | `/api/*` | 查询（GET）+ 特定操作（POST/PUT/DELETE） | ✅ 是 |
| **Server Action** | 页面内表单提交 | 增删改操作 | ❌ 仅内部表单调用 |

下文中标注「🔧 Server Action」的端点不对外暴露 REST 接口，仅供 Portal 管理后台表单调用。

### 1.5.1 REST 端点全量清单（2026-10-23 按 `route.ts` 重新校准）

**唯一真相源是源码**：`find apps/portal/src/app -name route.ts`。下表与该集合逐项对应
（共 **35** 个 handler 文件，其中 `/.well-known/openid-configuration` 不在 `/api/` 下）。
本文档正文若与源码冲突，以源码为准（`docs/README.md` §三 第 1 条）。

| # | 方法与路径 | 源码（相对 `apps/portal/src/app/`） | 权限 / 认证 | 本文档章节 |
|---|---|---|---|---|
| 1 | `GET /.well-known/openid-configuration` | `.well-known/openid-configuration/route.ts` | 公开 | §3.1 |
| 2 | `GET /api/auth/oauth2/authorize` | `api/auth/oauth2/authorize/route.ts` | Cookie `portal_jwt_token` / `login_session` | §3.3 |
| 3 | `POST /api/auth/oauth2/token` | `api/auth/oauth2/token/route.ts` | Client 凭证（Basic / POST body） | §3.4 |
| 4 | `GET /api/auth/oauth2/userinfo` | `api/auth/oauth2/userinfo/route.ts` | Bearer AT（亦回退 Cookie） | §3.5 |
| 5 | `POST /api/auth/oauth2/introspect` | `api/auth/oauth2/introspect/route.ts` | Client 凭证 | §3.6 |
| 6 | `POST /api/auth/oauth2/revoke` | `api/auth/oauth2/revoke/route.ts` | Client 凭证 | §3.7 |
| 7 | `GET /api/auth/jwks` | `api/auth/jwks/route.ts` | 公开 | §3.2 |
| 8 | `POST /api/auth/login` | `api/auth/login/route.ts` | 公开 | §2.1 |
| 9 | `POST` / `GET /api/auth/logout` | `api/auth/logout/route.ts` | Cookie / Bearer | §2.2 |
| 10 | `POST /api/auth/refresh` | `api/auth/refresh/route.ts` | Cookie `portal_refresh_token` | §2.3 |
| 11 | `GET /api/me` | `api/me/route.ts` | 会话 | §4.1 |
| 12 | `GET /api/me/permissions` | `api/me/permissions/route.ts` | 会话 | §4.2 |
| 13 | `GET /api/users` | `api/users/route.ts` | `portal:user:list` | §5.1 |
| 14 | `GET /api/users/[id]` | `api/users/[id]/route.ts` | `portal:user:read` | §5.3 |
| 15 | `GET` / `POST` / `DELETE /api/users/[id]/roles` | `api/users/[id]/roles/route.ts` | `portal:user:read` 或 `portal:user:assign_role`（GET）/ `portal:user:manage` 且 `portal:user:assign_role`（写） | §5.9 |
| 16 | `POST /api/users/[id]/force-logout` | `api/users/[id]/force-logout/route.ts` | `portal:user:manage` | §5.10 |
| 17 | `POST /api/users/[id]/reset-password` | `api/users/[id]/reset-password/route.ts` | `portal:user:reset_password` | §5.8 |
| 18 | `GET /api/roles` | `api/roles/route.ts` | `portal:role:list` 或 `portal:user:assign_role` | §6.1 |
| 19 | `GET /api/roles/[id]` | `api/roles/[id]/route.ts` | `portal:role:read` | §6.3 |
| 20 | `GET` / `POST` / `PUT /api/roles/[id]/permissions` | `api/roles/[id]/permissions/route.ts` | `portal:role:read`（GET）/ `portal:role:manage` 且 `portal:role:assign_permission`（写） | §6.6 |
| 21 | `GET /api/permissions` | `api/permissions/route.ts` | `portal:permission:list` | §7.1 |
| 22 | `GET /api/permissions/[id]` | `api/permissions/[id]/route.ts` | `portal:permission:read` | §7.3 |
| 23 | `GET /api/permissions/[id]/impact` | `api/permissions/[id]/impact/route.ts` | `portal:permission:delete` 或 `portal:permission:manage` | §7.7 |
| 24 | `POST /api/permissions/register` | `api/permissions/register/route.ts` | HTTP Basic（Client 凭证） | §7.6 |
| 25 | `GET /api/departments` | `api/departments/route.ts` | `portal:department:list` | §8.1 |
| 26 | `GET /api/departments/[id]` | `api/departments/[id]/route.ts` | `portal:department:read` | §8.3 |
| 27 | `GET /api/departments/[id]/members` | `api/departments/[id]/members/route.ts` | `portal:department:read` | §8.6 |
| 28 | `GET /api/clients` | `api/clients/route.ts` | `portal:client:list` | §9.1 |
| 29 | `GET /api/clients/[id]` | `api/clients/[id]/route.ts` | `portal:client:read` | §9.3 |
| 30 | `GET` / `DELETE /api/clients/[id]/tokens` | `api/clients/[id]/tokens/route.ts` | `portal:client:read`（GET）/ `portal:client:update`（DELETE） | §9.7 |
| 31 | `GET /api/audit/login-logs` | `api/audit/login-logs/route.ts` | `portal:audit:read` | §10.1 |
| 32 | `GET /api/audit/logs` | `api/audit/logs/route.ts` | `portal:audit:read` | §10.2 |
| 33 | `GET /api/audit/access-logs` | `api/audit/access-logs/route.ts` | `portal:audit:read` | §10.3 |
| 34 | `GET /api/audit/export` | `api/audit/export/route.ts` | `portal:audit:export` | §10.4 |
| 35 | `GET /api/health` | `api/health/route.ts` | 公开 | §2.5 |

**不在 §1.5.1 里的写操作**（创建/更新/删除用户、角色、权限、部门、应用，角色权限分配，
改密码等）**没有 REST 路由**——它们是 Server Action（`app/(dashboard)/*/actions.ts`），
本文档各节标注「🔧 Server Action」者即是。多权限声明（如 §5.9 GET、§6.1、§6.6 GET）
的事实语义是**满足任一即可**（`withPermission` 的 `requireAll` 默认 `false`，
`apps/portal/src/lib/auth/check-permission.ts`），不是"必须同时具备"。

---

## 2. 认证 API

### 2.1 登录

```
POST /api/auth/login
```

**认证：** 无需（公开端点）

**请求体（JSON）：**
```json
{
  "email": "admin@example.com",
  "password": "SecureP@ss1",
  "session_id": "optional-oauth-session-id"
}
```
**成功响应（200）：**
```json
// 授权请求绑定校验通过（浏览器持有本授权请求的一次性绑定 Cookie）：
{ "redirect": "/api/auth/oauth2/authorize?session_id=<session_id>" }

// 普通登录 / 绑定校验未通过 / 未提供 session_id：
{}
```

**说明（2026-10-23 实测契约）：**

- 成功响应**没有** `success` 字段，也不返回 `data` 包裹——这是登录端点作为内部自消费端点的
  既有形状（与前端 `apps/portal/src/app/login/login-form.tsx` 一致）；错误响应走统一
  `{ error, message }` 信封（如 401 `AUTH_SSO_2002`）。
- **请求体**：`email` 走 `EmailSchema`（ADR-026：`trim()` → `toLowerCase()` → 格式校验），
  因此**带前后空格或任意大小写的邮箱都能登录**同一身份；`password` 非空即可（策略在改密/建号侧），
  `session_id` 可选。`login_logs.username` 记录的是**用户输入原样**（取证用，不做规范化）。
- **状态语义（按代码）**：`DISABLED` → 403 `AUTH_SSO_2003`；`LOCKED` → 403 `AUTH_SSO_2004`
  （`validateLoginCredentials` 对这三态一律映射 403；423 只来自 §2.1 的**Redis 暴力破解锁定**，
  不是 `users.status=LOCKED`）；`DELETED` **刻意也映射到 `AUTH_SSO_2004`** 而非独立码，
  防止按错误码枚举用户状态（`apps/portal/src/domain/auth/login.ts`）；
  未设置密码 → 422 `AUTH_SSO_1005`。
- **授权请求绑定（ADR-023）**：只有请求同时携带 `session_id` 且浏览器持有 authorize 分支 B
  下发的 HttpOnly Cookie `oauth_request_binding`（与 Redis 暂存值一致）时，登录才会回跳
  OAuth；否则按普通登录处理（忽略 `session_id`，不阻断登录）。登录凭证 `login_session`
  仅在绑定成功时携带 `sid` claim。
- **时延抹平（H-04）**：邮箱不存在时也执行一次等值 bcrypt 比对，避免"存在 ≈300ms /
  不存在 ≈4ms"的用户枚举侧信道。
- **锁定语义（H-03/H-04.a，2026-10-23 ADR-025 修订：账户 × IP + IP 双维度）**：
  - **账户 × 客户端 IP**：同一 IP 对同一账户失败 5 次 / 15 分钟 → **423 `AUTH_SSO_2004`**。
    锁键含 IP，因此单个 IP 无法把受害者的账户锁给所有人（受害者换 IP 仍可登录）。
    可经 `BRUTE_FORCE_MAX_ATTEMPTS` / `BRUTE_FORCE_WINDOW_MINUTES` 覆盖。
  - **客户端 IP 总量**：同一 IP 跨账户失败 20 次 / 15 分钟 → **429 `AUTH_SSO_1008`**
    （`RATE_LIMITED`），不存在邮箱的尝试同样计数（枚举有成本）。
    可经 `BRUTE_FORCE_IP_MAX_ATTEMPTS` / `BRUTE_FORCE_IP_WINDOW_MINUTES` 覆盖。
  - 两者都基于 Redis 计数窗口，**不是** DB 级 `LOCKED`：用户 `status` 仍为 `ACTIVE`。
    登录成功清除该（账户, IP）计数；管理员"解锁"（`unlockUserAction`）清除该用户
    **全部 IP** 的账户计数。`users.status=LOCKED` 是另一条独立状态机（只能经解锁动作恢复）。

### 2.2 登出

```
POST /api/auth/logout
GET  /api/auth/logout
```

**认证：** Cookie `portal_jwt_token` 或 `Authorization: Bearer <JWT>`

**行为：** 清除 `portal_jwt_token`、`portal_refresh_token`、`login_session`、
`oauth_request_binding` Cookie；撤销当前 Access Token 的 jti（Redis 黑名单）、
撤销 login_session 的 jti、按 Cookie 撤销当前 Refresh Token，并按 userId 撤销全部 RT
（防御纵深）。以上统称"四层撤销"（H-SSO-004）。

**响应按调用形态分级（2026-10-23 起，ADR-009 增补）：**

| 形态 | 行为 |
|---|---|
| `POST`（fetch/XHR，非浏览器表单导航） | 执行四层撤销；`200` + JSON `{}`（REST 契约：无 `success` 包裹） |
| `POST`（浏览器表单导航：`Sec-Fetch-Mode: navigate` 或 urlencoded） | 执行四层撤销；`302` 到 `back_url`（安全校验后）或 `/login` |
| `GET`（可信顶级导航：地址栏直达 / 同站链接） | 执行四层撤销；`302` 到 `back_url` 或 `/login` |
| `GET`（跨站导航 / 来源不明） | **不执行任何撤销**；返回 200 HTML 确认页（`Cache-Control: no-store`、`X-Frame-Options: DENY`），用户须显式提交表单确认 |

> 为什么要分级：认证 Cookie 为 `SameSite=Lax`，跨站顶级 GET 导航会携带它；若 GET 直接撤销，
> 任意站点一个 `<a href>` 即可强制登出（H-09）。可信判定基于浏览器强制头 `Sec-Fetch-Site`，
> 缺失时以 Referer 同源回退，仍无法确认则按不可信处理（fail-closed）。

### 2.3 Token 刷新

```
POST /api/auth/refresh
```

**认证：** Cookie `portal_refresh_token`

**优化：** 若当前 Access Token **验签通过且**剩余时间 > 5 分钟，跳过刷新（避免无效轮换）。
（2026-10-23 修正：此前用未验签的 payload 决定跳过，可被伪造 exp 阻止轮换。）

**成功响应（200，浏览器直连形态）：**
```json
{ "expiresIn": 3600 }
```
同时下发 `Set-Cookie`：`portal_jwt_token`（AT，`Max-Age`=实际 AT TTL）与
`portal_refresh_token`（RT，`Max-Age`=**实际签发的 RT TTL**，来自 client 配置并钳制，见 §9.2）。

**受信任 Gateway 调用额外返回 token 明文：** 请求带 `X-Gateway-Timestamp` +
`X-Gateway-Signature`（HMAC，payload `refresh:{ts}`）且验签通过时，响应体为
`{ "expiresIn", "accessToken", "refreshToken" }`；浏览器/同源脚本无共享密钥，拿不到这两个字段。

**跳过刷新（200）：**
```json
{ "skipped": true, "remaining": 300 }
```

> 会话无效/过期时返回 `401`：缺少 RT Cookie 为 `AUTH_SSO_2025`（REFRESH_TOKEN_MISSING），
> RT 无效/已撤销为 `AUTH_SSO_2024`（REFRESH_TOKEN_INVALID）；两者都会清除两个 Cookie。

### 2.4 OAuth 回调

```
GET /api/auth/callback?code=<authorization_code>&state=<state>
```

**认证：** 无需（OAuth 2.1 Authorization Code + PKCE 流程的第二步）

**处理方：** **Gateway（Rust/Pingora）在边缘按 path 拦截处理**（path 取自 discovery 自定义字段 `com_authsso_callback_path`）。Portal 侧不存在该 route handler——ADR-010 确立 Gateway 是唯一 OAuth Client，Portal 侧历史实现已于 2026-09-30 移除。Portal client 的 redirect_uri 白名单仍需注册该路径（authorize 端点校验的是 Gateway 发来的 redirect_uri）。

**行为（Gateway 内，`apps/gateway/src/oauth_flow.rs` 的 `handle_oauth_callback`）：**
校验 state Cookie ↔ URL 一致性（CSRF）→ 读取 `pkce_verifier` Cookie → 内网 POST
`/api/auth/oauth2/token`（`code_verifier` 独立 body 字段）→ 校验 `id_token.nonce` ↔ Cookie
（fail-close 双向闭合，OIDC Core §3.1.2.2）→ Set-Cookie `portal_jwt_token` +
`portal_refresh_token` → 302 `return_to`。

**失败路径（同一文件）**：任一校验失败（缺 Cookie / state 不匹配 / PKCE 缺失 / 换取失败 /
nonce 不匹配）都 302 到 **`/login?error=<reason>`**（`reason` ∈ `access_denied` /
`token_exchange_failed` / `nonce_mismatch` 等），并同样清除 4 个临时 OAuth Cookie
（`oauth_state` / `pkce_verifier` / `oauth_nonce` / `return_to`，H-35：失败分支的卫生要求）。
**不存在** `/oauth/callback` 之类的 Portal 侧错误页；Portal 侧的 `oauth/error` 页面
（`apps/portal/src/app/oauth/error/page.tsx`）只服务 authorize 端点的错误重定向（§3.3）。

### 2.5 健康检查

```
GET /api/health
```

**认证：** 无需（供 Docker 健康检查 / 负载均衡 / 监控使用）
**源码：** `apps/portal/src/app/api/health/route.ts`（此前本文档漏写）

**响应（200 / 503）：** 并行探测 PostgreSQL（`SELECT 1`）与 Redis（`PING`）后返回复合状态：

```json
{
  "status": "healthy",
  "timestamp": "2026-10-23T08:00:00.000Z",
  "checks": {
    "database": { "status": "ok", "latencyMs": 2 },
    "redis":    { "status": "ok", "latencyMs": 1 }
  }
}
```

| 两项探测结果 | `status` | HTTP |
|---|---|---|
| 都 `ok` | `healthy` | 200 |
| 一项 `ok` | `degraded` | 503 |
| 都 `fail` | `unhealthy` | 503 |

> 只有 `healthy` 才返回 200：探针不因"一半依赖挂了"而放行。
> 与 Gateway 的 `/healthz`（§15，仅 GET/HEAD 返回 `ok`）不是同一端点，两者都在部署栈里被使用。



---

## 3. OIDC Provider API

### 3.1 OIDC Discovery

```
GET /.well-known/openid-configuration
```

返回 OIDC Discovery 元数据。**字段清单以源码为准**：`apps/portal/src/app/.well-known/openid-configuration/route.ts`，
每个数组常量的值来自 `packages/contracts/src/oidc.ts`（单一真相源，禁止手写字面量）。

| 字段 | 值 / 说明 |
|---|---|
| `issuer` | `getIssuer()`（`PORTAL_ISSUER` 优先，默认 `NEXT_PUBLIC_APP_URL`；**先 trim 再去尾斜杠**，与取 metadata 的 URL 必须同源，OIDC Discovery §4.3） |
| `authorization_endpoint` | `${baseURL}/api/auth/oauth2/authorize` |
| `token_endpoint` | `${baseURL}/api/auth/oauth2/token` |
| `userinfo_endpoint` | `${baseURL}/api/auth/oauth2/userinfo` |
| `introspection_endpoint` | `${baseURL}/api/auth/oauth2/introspect` |
| `revocation_endpoint` | `${baseURL}/api/auth/oauth2/revoke` |
| `jwks_uri` | `${baseURL}/api/auth/jwks` |
| `end_session_endpoint` | `${baseURL}/api/auth/logout`（RP-Initiated Logout 1.0；该端点的分级行为见 §2.2） |
| `com_authsso_refresh_endpoint` | `${baseURL}/api/auth/refresh`（**自定义扩展字段**，RFC 8414 §2 命名空间；消费方仅 Gateway） |
| `com_authsso_callback_path` | `/api/auth/callback`（Gateway 拦截 OAuth callback 的路径，值取自 contracts 的 `OAUTH_CALLBACK_PATH`） |
| `scopes_supported` | `["openid","profile","email","offline_access"]` |
| `response_types_supported` | `["code"]` |
| `grant_types_supported` | `["authorization_code","refresh_token"]` |
| `subject_types_supported` | `["public"]` |
| `id_token_signing_alg_values_supported` | `["ES256"]` |
| `token_endpoint_auth_methods_supported` | `["client_secret_basic","client_secret_post"]` —— **不含 `none`**（无 public client；ADR-012 增补 §4） |
| `code_challenge_methods_supported` | `["S256"]` |
| `claims_supported` | `sub, iss, aud, exp, iat, jti, auth_time, nonce, name, preferred_username, email, email_verified, picture` |
| `authorization_response_iss_parameter_supported` | `true`（RFC 9207：authorize 响应带 `iss`） |

> **注意 `baseURL` 与 `issuer` 是两个取值、同一语义**：源码里端点前缀用 `getAppBaseURL()`，
> `issuer` 用 `getIssuer()`；两者都经 `packages/config/src/env.ts` 的 `resolvePublicUrls`
> 归一（trim + 去尾斜杠），部署时应配成同一入口 URL。
>
> **`com_authsso_refresh_endpoint` 只认 HttpOnly Cookie**（源码头注明示）：它被写成扩展字段
> 而非标准 `refresh_token` grant 端点，正是因为第三方客户端照此调用必然失败——本端点没有
> client 认证入参，只读 `portal_refresh_token` Cookie（§2.3）。
>
> **没有声明** `userinfo_signing_alg_values_supported` / `end_session_endpoint` 之外的
> RP-Initiated Logout 扩展字段（如 `post_logout_redirect_uris_supported`）；标准 RP 不应假设其存在。

### 3.2 JWKS 公钥集

```
GET /api/auth/jwks
```

返回 ES256 公钥集（JWKS 格式），Gateway 用于离线 JWT 签名验证。每个 key 固定带
`use: "sig"`、`alg: "ES256"`，`kid` 取 `jwks.kid`（旧数据无 `kid` 时回退行 `id`，与 JWT
`header.kid` 一致）。**轮换宽限**：`expiresAt` 已过期但仍在
`JWKS_PUBLISH_GRACE_SECS`（2h）宽限内的公钥继续发布，宽限外的历史密钥不再暴露——保证
轮换瞬间冷启动的验签方能取到旧公钥（ADR-021）。冷启动时端点会先确保库中至少有一对活跃密钥。


### 3.3 授权端点

```
GET /api/auth/oauth2/authorize
  ?response_type=code
  &client_id=<client_id>
  &redirect_uri=<redirect_uri>
  &scope=openid+profile+email
  &state=<random_state>
  &code_challenge=<PKCE_challenge>
  &code_challenge_method=S256
  &nonce=<random_nonce>
```

**认证：** Cookie `portal_jwt_token`（需已登录 Portal）或 `login_session`（登录后回跳，携带 `session_id`）

**行为（2026-10-23 起含授权请求绑定，ADR-023）：**

1. 分支 A（回跳，带 `session_id`）：验证 `login_session` → 校验其 `sid` claim 等于该
   `session_id` → 校验浏览器持有一次性 HttpOnly Cookie `oauth_request_binding` 且值与 Redis
   暂存一致 → 原子消费暂存参数（GETDEL）→ 校验 client/redirect_uri/scope → 签发授权码 →
   `302` 回 `redirect_uri`（带 `code`、`state`、`iss`）。
   任一绑定校验失败返回 `session_expired` 错误重定向，**且不消费暂存授权请求**。
2. 分支 B（首次授权，完整 query）：若已有有效会话（`login_session` 或 `portal_jwt_token`）→
   直接签发授权码（SSO 免登）；否则校验 client/redirect_uri/scope，把参数 + 一次性绑定值写入
   Redis，下发绑定 Cookie 并 `302` 到 `/login?session_id=…`。
3. 参数约束：`response_type=code`、`code_challenge_method=S256`、`state` 必填、`code_challenge` 必填、
   `redirect_uri` 必须是合法 URL；`redirect_uri` 必须与注册值**精确匹配**；未通过白名单的
   redirect_uri **不会**被重定向（决策 D1）。`scope` 必须是 client 注册 scope 的子集。

**错误重定向的两条通道（按 `apps/portal/src/lib/oauth-utils.ts`）：**

| 失败时机 | 响应 |
|---|---|
| `redirect_uri` **尚未**通过白名单（query 校验失败、client 未知/停用、绑定校验失败、降级 catch） | `302` 到本地错误页 `/oauth/error?error=<code>&message=…&iss=…`（`buildOAuthErrorRedirect`）；绑定类失败用 `error=session_expired` |
| `redirect_uri` **已**通过白名单（scope 越界、用户不可用、无准入角色） | `302` 回 RP 的 `redirect_uri`，带 `error` / `error_description` / `state`（原请求携带时回传）/ `iss`（`buildRfc6749ErrorRedirect`，RFC 6749 §4.1.2.1 + RFC 9207） |

已通过白名单后可能回跳的 `error` 取值（源码字面量）：`invalid_scope`（`AUTH_SSO_2037` 映射）、
`user_inactive`（用户不存在或非 ACTIVE）、`unauthorized_client` 或 `validateAuthorization`
给出的 `errorCode`。**成功**响应除 `code`/`state` 外还带 `iss`；同时清除
`login_session` 与 `oauth_request_binding` 两个一次性 Cookie。


### 3.4 Token 端点

```
POST /api/auth/oauth2/token
```

**认证：** `client_id` + `client_secret`（Basic Auth 或 POST body，RFC 6749 §2.3.1；两者并存时以 Basic 为准，不一致拒绝）

**请求体（application/x-www-form-urlencoded 或 JSON）：**
```
grant_type=authorization_code
&code=<authorization_code>
&redirect_uri=<redirect_uri>
&code_verifier=<PKCE_verifier>
```

**成功响应（200）：**
```json
{
  "access_token": "<jwt>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "<opaque>",
  "id_token": "<jwt>",
  "scope": "openid profile email"
}
```

**2026-10-23 明确的协议细节（逐条对应 `apps/portal/src/app/api/auth/oauth2/token/route.ts`）：**

- **请求体解析**：`application/x-www-form-urlencoded` 按 form 解析；其它（含 JSON、未声明
  Content-Type）先试 JSON，失败再按 form 解析（`lib/auth/oauth-body.ts`）。
- **`grant_type` 只接受 `authorization_code` / `refresh_token`**（`OAUTH_PARAMS`）：
  缺省或其它值 → `400 invalid_request`；`authorization_code` 缺 `redirect_uri` → `400 invalid_request`；
  缺 `code`/`code_verifier`、缺 `refresh_token` 同样是 `400 invalid_request`。
- `expires_in` = **该 client 配置并钳制后的实际 AT TTL**（默认 3600；钳制 60s–86400s），
  与 JWT 的 `exp-iat` 严格一致（ADR-024）。`refresh_token` 行 `expires_at` 同样按该 client 的
  `refresh_token_ttl` 钳制（默认 604800s；钳制 300s–2592000s）。取值来源：`clients.access_token_ttl` /
  `clients.refresh_token_ttl`，缺失/非法回退默认、越界收敛到边界（`lib/auth/token.ts` 的
  `ACCESS_TOKEN_TTL_BOUNDS` / `REFRESH_TOKEN_TTL_BOUNDS` / `clampTokenTtl`）。
> **文档守卫**：本文属于要随代码维护的导航文档，改动后跑 `apps/portal/__tests__/api/docs-*.test.ts`
> （`docs-claims.test.ts` 校验本文可重算的数字声明、`docs-api-error-codes.test.ts` 校验 §12 的每个
> `AUTH_SSO_<n>` 都是 `packages/contracts` 的真实线值）。引用代码用**路径 + 章节/符号名，不写行号**（AGENTS.md「必须」）。
- `refresh_token` 仅在授权 scope 含 `offline_access` 时返回；`id_token` 仅在含 `openid` 时返回
  （OIDC Core §11）。`scope` 恒为**授权码里记录的 scope**（refresh grant 则为 `rt.scopes`），
  由 `domain/auth/token-response.ts` 这个唯一组装点产出。
- 所有成功/失败响应都带 `Cache-Control: no-store` + `Pragma: no-cache`（RFC 6749 §5.1 MUST；
  `lib/auth/oauth-helpers.ts` 的 `withOAuthNoStore`）。
- `authorization_code` 兑换顺序：`redirect_uri` 与 code/client/used/未过期**一起**进原子领取
  WHERE（错误 redirect **不消耗** code、不触发家族撤销）；PKCE 校验在领取之后，校验失败时
  code 保持已消费（防离线穷举，见 ADR-017 增补）。
- `refresh_token` grant：RT 必须属于当前认证 client（sender 绑定）；重放已撤销 RT 会撤销
  同 `(userId, clientId)` 家族的**全部** RT。
- **client 认证**：`authenticateOAuthClient` = 查库 + 激活校验 + 密钥校验；失败经
  `mapToOAuthError` 映射为 `401 invalid_client`。授权码重放额外写一条 `TOKEN_REFRESH_FAILED`
  登录日志（`username` 字段记 `client_id`——token 端点无真实用户上下文）。

### 3.5 UserInfo 端点

```
GET /api/auth/oauth2/userinfo
Authorization: Bearer <access_token>
```

**认证：** Bearer Token（Access Token）。**Cookie 回退**：无 `Authorization` 头时读
`portal_jwt_token` Cookie（Portal 自用的非标准扩展，便于浏览器页面直连）。
**audience 不校验**（`verifyAccessToken(token, null, …)`）：userinfo 是多 client 通用端点，
持有 Bearer 即被授权方（ADR-012 增补 §1）。`typ` 必须是 `at+jwt`（缺失即拒）。

**响应（200）：** 字段**由 AT 的 `scope` claim 决定**——`sub` 恒返回；`profile` 追加
`name` / `preferred_username` / `picture`；`email` 追加 `email` / `email_verified`。

```json
{
  "sub": "<user_id>",
  "name": "张三",
  "preferred_username": "zhangsan",
  "picture": "https://example.com/avatar.png",
  "email": "zhangsan@example.com",
  "email_verified": false
}
```

**错误（RFC 6750 §3）：** 响应体只认 OAuth 错误名，不返回内部 `AUTH_SSO_xxxx` 码。

| 场景 | 状态 | 响应体 | `WWW-Authenticate` |
|---|---|---|---|
| 未提供任何凭证 | 401 | `{"error":"invalid_token"}` | `Bearer` |
| AT 无效 / 过期 / 已撤销（jti 黑名单）/ 用户不存在 | 401 | `{"error":"invalid_token"}` | `Bearer error="invalid_token"` |
| 403 类失败 | 403 | `{"error":"insufficient_scope"}` | `Bearer error="insufficient_scope"` |
| 服务器错误 | 5xx | `{"error":"server_error"}` | — |

所有响应带 `Cache-Control: no-store` / `Pragma: no-cache`。


### 3.6 Introspection 端点

```
POST /api/auth/oauth2/introspect
```

**认证：** `client_id` + `client_secret`

**请求体：**
```
token=<access_token>
&client_id=<client_id>
&client_secret=<client_secret>
```

**归属策略（2026-10-23 起，H-07）：** 只向**签发该令牌的 client** 披露元数据——
AT 分支要求 `claims.client_id === 调用方 client`，RT 分支按 `(tokenHash, clientId)` 查询；
其他 client 一律返回与"未知 token"同形的 `{"active": false}`（RFC 7662 §2.1 端点保护策略）。
**client 认证失败 → 401 `{"error":"invalid_client","error_description":"客户端凭证无效"}`**
（这是唯一会返回错误体的分支；其余异常一律 `{"active": false}`）。

**AT 分支响应（200）：** audience **不校验**（`verifyAccessToken(token, null, …)`），
`active` 已含 jti 黑名单复核（Redis 故障 fail-close）：

```json
{
  "active": true,
  "sub": "<user_id>",
  "scope": "openid profile email",
  "client_id": "<client_id>",
  "aud": "<client_id>",
  "token_type": "Bearer",
  "exp": 1234567890,
  "iat": 1234567890,
  "iss": "https://<入口主机>",
  "jti": "<uuid>"
}
```

- `aud` 与 `client_id` **同源同值**（`aud = client_id`，ADR-013），仅当 AT 携带 `client_id` 时出现；
  `scope` 也只在 AT 确实带 `scope` 时出现（RFC 7662 §2.2 除 `active` 外均为可选）。

**RT 分支响应（200）：**

```json
{
  "active": true,
  "scope": "openid profile email offline_access",
  "client_id": "<client_id>",
  "sub": "<user_id>",
  "token_type": "refresh_token"
}
```

- RT 分支的 `active` = 未撤销 **且** 未过期；`scope`/`client_id`/`sub` 来自 RT 行
  （ADR-012 决策 3：AT 无此数据时由 RT 分支提供）。
- token 不可识别 → `{"active": false}`（RFC 7662 §2.2：不得返回错误）。

响应带 `Cache-Control: no-store` / `Pragma: no-cache`。


### 3.7 Revocation 端点

```
POST /api/auth/oauth2/revoke
```

**认证：** `client_id` + `client_secret`

**请求体：**
```
token=<token>&client_id=<client_id>&client_secret=<client_secret>
&token_type_hint=<access_token|refresh_token>   # 可选
```

**语义（2026-10-23 起，RFC 7009 §2.1）：** `token_type_hint` 只是提示——按提示找不到时服务端
**必须**扩展搜索其它类型；因此本端点总是同时尝试 AT（jti 黑名单）与 RT（DB revoked），
不因 hint 错误而静默跳过。撤销归属限定当前认证 client：AT 要求 `client_id` claim 且
`jti`/`exp` 存在，RT 要求 `(tokenHash, clientId)` 匹配；他人 token 静默忽略（防跨 client 撤销 DoS）。
**audience 不校验**（`verifyAccessToken(token, null, …)`）：归属由 `client_id` claim 判定。
`token` 缺失时直接 `200 {}`（不查库）。
**AT 级联退出**：AT 撤销只写 jti 黑名单，**不**级联撤销同家族的 RT（ADR-013 决策 4：有意接受）。

**client 认证失败 → 401 `{"error":"invalid_client","error_description":"客户端凭证无效"}`**；
除此之外的一切情形（含 token 不存在、内部异常）都返回 `200 {}`（RFC 7009 §2.2），响应带
`Cache-Control: no-store` / `Pragma: no-cache`。


---

## 4. 当前用户 API（/api/me）

### 4.1 获取当前用户信息

```
GET /api/me
```

**认证：** Cookie `portal_jwt_token` 或 `Authorization: Bearer <JWT>`（有 `X-User-Id` 时信任网关注入、
零验签快速解码；否则自验签兜底）。未登录 → 401 `AUTH_SSO_1002`。

**响应（200，`restSuccess` 直出，无 `success`/`data` 包裹）：**
```json
{
  "user": {
    "id": "<uuid>",
    "email": "admin@example.com",
    "name": "系统管理员",
    "picture": "https://example.com/avatar.png",
    "emailVerified": false
  },
  "tokenInfo": {
    "expiresAt": 1234567890000,
    "issuedAt": 1234567890000
  },
  "permissions": ["portal:user:list", "portal:user:create", "..."],
  "roles": ["SUPER_ADMIN"],
  "deptIds": ["<uuid>", "..."],
  "menus": [...]
}
```

> `tokenInfo.expiresAt` / `issuedAt` 是 **毫秒**时间戳（JWT 的秒值 ×1000）；claim 缺失时为 `null`。
> `menus` 是**按当前主体权限过滤后的动态菜单树**（`getDynamicMenuTree`），不是全量菜单。

### 4.2 获取当前用户权限

```
GET /api/me/permissions
```

**响应（200）：** 同样是 `restSuccess` 直出——**没有 `data` 包裹**（2026-10-23 校正：
此前本节画的 `{ "data": {...} }` 与源码不符，`restSuccess` 直接把对象作为响应体）：

```json
{
  "userId": "<uuid>",
  "roles": [{ "id": "<uuid>", "code": "SUPER_ADMIN", "name": "超级管理员" }],
  "permissions": ["portal:user:list", "portal:user:create", "portal:user:read", "..."],
  "deptIds": ["<uuid>", "..."]
}
```

> **`roles` 是对象数组**（`UserPermissionContext.roles` 的元素形如 `{id, code, name}`），
> 不是 §4.1 里那种角色编码字符串数组。取编码请读 `roles[].code`。
> 权限上下文不可用 → 500 `AUTH_SSO_1006`（「无法获取用户权限上下文」）；未登录 → 401 `AUTH_SSO_1002`。


> **注意（2026-10-23 口径更正）：** `deptIds` 是**用户所有 ACTIVE 角色的 `roles.dept_id` 原始值
> 列表，未做子树展开**（不是"可见部门集合"）。子树展开只在 Portal 内部由
> `lib/authz/data-scope.ts` 的 `resolveScope()` 按请求实时完成（ADR-002 增补 / ADR-014）。
> 外部消费方若要用它做数据范围，必须自行展开或改用授权接口，不能直接当作可见部门集合。
>
> **注意：** 菜单数据由 DashboardLayout 客户端通过 `getUserMenus()` 函数调用获取（Server Component 级），无独立 `/api/me/menus` REST 端点。

### 4.3 自助修改个人资料（🔧 Server Action）

`updateOwnProfileAction` — 由 Portal 个人资料页（`/profile`）调用，登录用户本人即可，无需额外权限。

**可修改字段：** `name`、`email`、`avatarUrl`（不允许修改 `status` / `deptId` / 角色，防止越权）。
`email` 同样走 `EmailSchema` 规范化（trim + 小写，ADR-026），因此**大小写变体会被判为同一身份**
（`EMAIL_ALREADY_EXISTS`，409）。成功返回 `{ success: true, data: { id }, message }`。

**目标用户锁定：** 由 `withAuth` 注入的 `ctx.userId` 决定，调用方无法指定其他用户 ID（防 IDOR）。

### 4.4 自助修改密码（🔧 Server Action）

`changeOwnPasswordAction` — 由 Portal 个人资料页调用，登录用户本人即可（`withAuth({})`，无额外权限）。
编排在 `apps/portal/src/lib/account/change-password.ts` 的 `changeOwnPassword`。

**流程：**
1. 断言账号**有密码**（`assertHasPassword`）：未设置密码 → 422 `AUTH_SSO_1005`（不再被误报成"当前密码错误"）。
2. 校验 `currentPassword`（bcrypt 比对），不匹配返回 `{success:false}` + `AUTH_SSO_1005`（「当前密码错误」）。
3. **旧密码正确之后**才校验 `newPassword`：满足 `PasswordSchema`（**至少 10 位，大写/小写/数字/
   特殊字符四类中至少三类**），且不得与**最近 5 次历史密码 + 当前密码**相同（H-C-06）。
4. `hashPassword(newPassword)` 后写入 `users.passwordHash`，同时更新 `passwordChangedAt`
   与 `passwordHistory`。
5. **失效当前用户所有活跃会话**（RT 全部 revoked + AT jti 黑名单，两层都做），用户需用新密码
   重新登录（NFR-SEC-13）。**撤销失败不阻断改密**（尽力而为，失败只记日志）——这与管理员
   重置密码（§5.8）不同：那里撤销是操作目的本身，失败必须回滚。

**审计：** 自动记录 `TOKEN_REVOKE` 操作（`withAuth` 的 `audit: 'TOKEN_REVOKE'` 在成功返回后写入）。


---

## 5. 用户管理

**认证：** 所有端点需要 `portal_jwt_token`。数据范围受角色部门约束。

### 5.1 用户列表（REST）

```
GET /api/users?page=1&pageSize=20&keyword=张三&status=ACTIVE&deptId=<uuid>
```

**权限：** `portal:user:list`

**过滤参数（源码 `apps/portal/src/app/api/users/route.ts`）：**

| 参数 | 事实语义 |
|---|---|
| `page` / `pageSize` | `parsePagination` 钳制：非法值回退 `page=1`、`pageSize=20`，`pageSize` 上限 100（`MAX_PAGE_SIZE`） |
| `keyword` | 截断到 100 字符；服务端匹配 |
| `status` | `ALL` 或 `USER_STATUS_VALUES`（`ACTIVE`/`DISABLED`/`LOCKED`/`DELETED`）——**非法值 400 `AUTH_SSO_1005`** |
| `deptId` | 必须是 UUID，否则 400；在已授权数据范围内**叠加**筛选 |

> 列表**默认不含 DELETED**（读模型 WHERE 恒带 `status != 'DELETED'`）；因此 `status=DELETED`
> 与默认条件叠加后**恒为空集**，不是"只看已删除"。`status=ALL` 表示不加状态条件（仍排除 DELETED）。
> 范围外 / 无范围（`isScopeDenied`）返回空数组而不是 403。

**响应：**

```json
{
  "data": [
    {
      "id": "<uuid>",
      "username": "zhangsan",
      "email": "zhangsan@example.com",
      "name": "张三",
      "avatarUrl": null,
      "status": "ACTIVE",
      "deptId": "<uuid>",
      "deptName": "技术部",
      "createdAt": "2026-01-01T00:00:00Z",
      "lastLoginAt": null
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```

### 5.2 创建用户（🔧 Server Action）

`createUserAction` — 由 Portal 创建用户表单调用，权限 `portal:user:create`。

**表单字段：** `username`、`name`、`email`、`password`、`deptId`（UI 必填；服务端 schema 仍接受
`null` 以兼容历史调用，但**无部门用户会因数据范围 `dept_id IS NULL` 在列表/详情中不可见**，
不应主动创建）

**约束：** 用户名和邮箱全局唯一（邮箱部分唯一索引 `WHERE deleted_at IS NULL`；用户名完整唯一，
软删除后不释放）。密码策略：**至少 10 位，大写/小写/数字/特殊字符四类中≥3 类**（2026-10-23
以代码为准统一，此前文档写 8 位）。`email` 经 `EmailSchema` 规范化后落库（ADR-026），所以
`Admin@Example.com` 与 `admin@example.com` 会被判为同一身份（409 `AUTH_SSO_3004`）。
`deptId` 若非空，必须存在且 `ACTIVE`（H-23），否则 422。

**成功：** `{ success: true, data: { id }, message: "用户创建成功" }`。

### 5.3 查看用户详情（REST）

```
GET /api/users/:id
```

**权限：** `portal:user:read`

**约束：** 只能查看数据权限范围内的用户（范围约束由读口在 SQL 内施加）。

**范围外与不存在同形返回 404** —— 读路径不用状态码区分用户是否存在（ADR-014 第 3 步）。

### 5.4 更新用户（🔧 Server Action）

`updateUserAction` — 由 Portal 用户详情编辑表单调用，权限 `portal:user:update`。

**可编辑字段：** `name`、`email`、`deptId`、`status`、`avatarUrl`

**状态机约束（2026-10-23 起，H-17）：**

- `ACTIVE ⇄ DISABLED` 与 `→ LOCKED`：允许；
- `LOCKED → 其它状态`：**拒绝**（必须走 `unlockUserAction`）；
- `→ DELETED`：**必须走** `deleteUserAction`（会同时写 `deletedAt`、释放部分唯一索引）；
  经 update 提交 `DELETED` 会按删除语义处理，不允许只改 status 留下 `deleted_at IS NULL`；
- 状态或部门发生实际变化 ⇒ 撤销该用户全部 AT（jti 黑名单）+ 刷新权限缓存
  （此前直写 status 不撤 AT，被禁用/锁定用户的旧 AT 仍可用至自然过期）；仅改名/邮箱等
  不改变决策的变更 ⇒ **只刷缓存、不撤 AT**。

**部门迁移守卫（2026-10-23 起）：**

- 迁入部门必须存在且 `ACTIVE`（H-23）；
- **不能清空已有部门**（`deptId: null` 且当前非空 → 422），否则会制造"谁都改不了"的死锁态（H-24）；
- 用户已绑定**其他部门**的角色时禁止迁部门（R-USER-ROLE，422），须先解除角色（H-25）；
- 目标用户当前部门（含无部门的受控例外）与拟迁入部门**都**必须在操作者数据范围内。

### 5.5 切换用户状态（🔧 Server Action）

`toggleUserStatusAction` — 由 Portal 用户列表操作按钮调用，权限 `portal:user:update`。

**行为：** ACTIVE ⇄ DISABLED 切换；`LOCKED` 用户**不经**此动作（列表按钮对 LOCKED 用户改调
`unlockUserAction`）；`DELETED` 用户拒绝。业务码 `CANNOT_DISABLE_SELF`（`AUTH_SSO_3009`，422）：
只拦"把自己从 ACTIVE 变成其他状态"；自己已处于禁用态时再启用是自救，**允许**。
状态写入后 `await revokeUserAccessByUserId`（撤销该用户全部 AT jti）。

### 5.6 解锁用户（🔧 Server Action）

`unlockUserAction` — 权限 `portal:user:update`。

**行为：** 仅 LOCKED → ACTIVE；成功后清除该用户的暴力破解 Redis 计数（否则窗口期内仍被 423）。
**入口（2026-10-23 起）**：用户列表对 LOCKED 行显示「解锁」、用户详情页有「解锁」按钮
（此前该 action 无任何 UI 引用、HTTP 不可达，唯一"解锁"路径是 update 直写旁路）。

### 5.7 删除用户（🔧 Server Action）

`deleteUserAction` — 由 Portal 用户详情页调用，权限 `portal:user:delete`。

**行为：** 逻辑删除（`status=DELETED` + `deletedAt` 写入），撤销全部 AT + 刷新权限缓存；
不能删除自己（`CANNOT_DELETE_SELF`）。已删除用户不可恢复、不可再编辑。

### 5.8 重置用户密码（REST + 🔧 Server Action）

```
POST /api/users/:id/reset-password    （REST）
```

`resetPasswordAction` — Server Action（Portal 表单调用），权限 `portal:user:reset_password`

**请求体：**
```json
{ "password": "NewSecureP@ss1" }
```

**约束与副作用（2026-10-23 起）：**

- 密码策略同上（≥10 位 + 四类中≥3 类）；禁止重用最近 5 次历史**与当前密码**；
- **RT 撤销与密码写入在同一事务内**：撤销失败 ⇒ 整体回滚、响应失败（不再出现"密码已改但
  旧 RT 仍可续期"的部分成功）；
- 事务提交后尽力撤销 AT jti（Redis 故障不阻断，旧 AT ≤1h 自然过期兜底）；
- 请求体非法 JSON ⇒ 400。

### 5.9 管理用户角色（REST + 🔧 Server Action）

```
GET    /api/users/:id/roles   — 获取用户当前角色
POST   /api/users/:id/roles   — 覆盖式分配角色
DELETE /api/users/:id/roles   — 移除指定角色
```

**权限：** `portal:user:read` **或** `portal:user:assign_role`（GET，满足其一即可——分配对话框
需读"当前已绑定角色"）/ `portal:user:manage` **且** `portal:user:assign_role`（POST、DELETE，H-ACL-003 组合权限）。

**请求体：**

| 方法 | 请求体 | 说明 |
|---|---|---|
| POST | `{ "roleIds": ["<uuid>", ...] }` | 覆盖式（`RoleAssignmentSchema`），非法 → 400 |
| DELETE | `{ "roleId": "<uuid>" }` | **精准移除单个角色**（`RoleRemovalSchema`），绝不误删该用户其他角色；移除最后一个角色 → **400**（服务端不变量，与 RoleAssignmentSchema.min(1) 对齐） |

- 用户不存在 / 超出数据范围 → 404 `AUTH_SSO_1004`（范围外与不存在同形，ADR-014）。
- 成功：POST 直出 `{ "assignedCount": <number> }`；DELETE 直出 `{}`。
- 写编排在 `lib/user-role-assignment.ts`（范围守卫 / 事务 / 部门约束 R-USER-ROLE / 审计
  `USER_ROLE_ASSIGN` / 权限收敛），REST 与 Server Action **共用同一实现**。

**Server Action：** `updateUserRolesAction(user.id, roleIds)` —— 由 Portal「分配角色」对话框
（`users/components/AssignRoleDialog.tsx`）调用，权限 `portal:user:manage` 且 `portal:user:assign_role`，
返回 `{ success: true, data: { assignedCount } }`。**不存在**名为 `assignUserRolesAction`
的行动（2026-10-23 核对：全仓只有 `updateUserRolesAction`）。

### 5.10 强制下线用户（REST）

```
POST /api/users/:id/force-logout
```

**权限：** `portal:user:manage`

**行为：** 撤销目标用户所有活跃 Token（jti 入黑名单）。

**响应：**
```json
{
  "userId": "<uuid>",
  "revokedJtiCount": 3,
  "jtiRevocationFailed": false,
  "message": "已强制下线用户 …，撤销 3 个 Access Token JTI"
}
```

`jtiRevocationFailed` **必须**与 `revokedJtiCount` 一起消费：jti 撤销是 ADR-011 分级下的
尽力而为（Redis 故障既不抛错也不阻断整个下线），因此 `revokedJtiCount: 0` 同时可能是
「该用户没有活着的 AT」与「Redis 不可用、一个都没撤成」。仅凭数字无法区分，调用方
（含管理端 UI）须用该布尔量判断后者。

---

## 6. 角色管理

**认证：** 所有端点需要 `portal_jwt_token`。

### 6.1 角色列表（REST）

```
GET /api/roles?page=1&pageSize=20&keyword=管理&status=ACTIVE
```

**权限：** `portal:role:list` **或** `portal:user:assign_role`（两者满足其一即可——用户角色
分配对话框需要枚举候选角色；此前只认 `role:list`，只有 `assign_role` 的操作员会静默拿到 403）。

**过滤参数：** `status` ∈ `ENTITY_STATUS_VALUES`（`ACTIVE|DISABLED`），**非法值 400
`AUTH_SSO_1005`**；`keyword` 服务端搜索；分页默认 20（`pageSize` 上限 100）。
数据范围由 `scopeFilter` 施加，范围外角色不出现在结果里。

### 6.2 创建角色（🔧 Server Action）

`createRoleAction` — 由 Portal 创建角色弹窗调用，权限 `portal:role:create`。

### 6.3 查看角色详情（REST）

```
GET /api/roles/:id
```

**权限：** `portal:role:read`

### 6.4 更新角色（🔧 Server Action）

`updateRoleAction` — 由 Portal 角色编辑弹窗调用，权限 `portal:role:update`。

**约束（2026-10-23 起）：**

- 系统内置角色（`is_system=true`）禁止修改/删除（专属业务码 `CANNOT_MODIFY_SYSTEM_ROLE` /
  `CANNOT_DELETE_SYSTEM_ROLE`）；
- 角色 `code` **不可变更**（Update schema 不含 `code`）；
- 迁入部门必须存在且 `ACTIVE`（`assertDeptUsable`，与创建路径一致）；
- 若该角色仍有绑定用户，**禁止**迁往其他部门（避免 `user_roles` 跨部门漂移——审计 H-25）；
- 部门/状态变化会影响权限决策 ⇒ 撤销该角色全部绑定用户的 AT + 刷新权限缓存；仅改名/描述只刷缓存。

### 6.5 删除角色（🔧 Server Action）

`deleteRoleAction` — 由 Portal 调用，权限 `portal:role:delete`。

**行为：** 删除角色及其所有权限绑定/用户绑定；系统内置角色拒绝；删除属于权限决策变更 ⇒
绑定用户撤销 AT + 刷新缓存。

### 6.6 角色权限（REST）

```
GET  /api/roles/:id/permissions   — 获取角色的权限
POST /api/roles/:id/permissions   — 覆盖式设置角色权限
PUT  /api/roles/:id/permissions   — 更新角色权限（与 POST 同一写路径）
```

**权限：** `portal:role:read`（GET）/ `portal:role:manage` **且** `portal:role:assign_permission`（POST、PUT，H-ACL-003 同类组合权限）

**GET：** 角色不存在或超出数据范围 → 404 `AUTH_SSO_1004`；成功 `restSuccess(permissions)` 直出。

**POST / PUT：** 请求体 `{ "permissionIds": ["<uuid>", ...] }`；Zod 校验失败 → 400
`AUTH_SSO_1005`。编排在 `lib/role-permission-assignment.ts`（与 Server Action
`updateRolePermissionsAction` 共用同一实现）：范围守卫 / 系统角色守卫 / 权限有效性 /
事务内删旧插新 / 审计 `ROLE_PERMISSION_ASSIGN` / 权限收敛。成功响应直出
`{ "roleId": "<uuid>", "permissionIds": [...] }`。语义是**覆盖式**（全量替换），不是增量追加。

---

## 7. 权限管理

**认证：** 所有端点需要 `portal_jwt_token`。

> **权限树是全局命名空间（ADR-001）**：`permission:*` 是全局能力码，不具备部门（dept）维度，
> 因此**不受数据范围门面（ADR-014）约束**。授予 `portal:permission:update/delete` 等价于授予
> "全局权限树管理权"，只能授给可信管理员。

### 7.1 权限列表（REST）

```
GET /api/permissions?page=1&pageSize=50&type=API&keyword=user
```

**权限：** `portal:permission:list`

**过滤参数（源码 `apps/portal/src/app/api/permissions/route.ts`）：**

- `type` ∈ `PERMISSION_TYPE_VALUES`（`DIRECTORY|PAGE|API`），**非法值 400 `AUTH_SSO_1005`**；
- `keyword` —— **REST 路由不读取**该参数（`lib`/`data` 层的 `getPermissionPage` 支持 `keyword`，
  但路由只透传 `type`；关键字搜索目前只在页面 Server Component 侧生效）。
- 分页：`parsePagination(sp, 50)`——**默认 50 条/页**（不是 15），`pageSize` 上限 100
  （2026-10-23 按源码校正：此前文档写"分页默认 15/页"与代码不符）。


### 7.2 创建权限（🔧 Server Action）

`createPermissionAction` — 由 Portal 创建权限弹窗调用，权限 `portal:permission:create`。

**类型约束：** DIRECTORY/PAGE 只允许菜单字段（`path`/`icon`/`visible`/`sort`/`parentId`），
PAGE 必须有 `path`；API 只允许 `clientId` + `code`（`{clientId}:{resource}:{action}`），
不得混入导航字段（DB CHECK + 领域归一/校验）。Portal 管理页创建的 `portal:*` API 权限自动绑定
`client_id='portal'`（否则非管理员角色无法通过 OAuth 准入）。

### 7.3 查看权限详情（REST）

```
GET /api/permissions/:id
```

**权限：** `portal:permission:read`

### 7.4 更新权限（🔧 Server Action）

`updatePermissionAction` — 由 Portal 调用，权限 `portal:permission:update`。

**约束（2026-10-23 起，H-19/H-B-04）：**

- **`code` 不可变更**：请求携带 `code` 会被显式拒绝（不静默忽略），对应需求 D-PRM-U
  「权限编码创建后不可修改」；
- `parentId` 变更前校验：父级存在（不存在 404）、不是自身、不是自身后代（递归子树环检测）；
- `type` 变更时按新类型归一/校验字段（API→PAGE 清空 `clientId`；PAGE 缺 `path` 拒绝；
  DIRECTORY→API 清空菜单字段），避免撞 DB CHECK 变成不可行动的 422；
- 更新后收敛受影响用户（撤销 AT + 刷新权限缓存）。

### 7.5 删除权限（🔧 Server Action）

`deletePermissionAction` — 由 Portal 调用，权限 `portal:permission:delete`。

**约束（2026-10-23 起，H-20/H-B-01）：**

- **核心权限码保留清单**：`ALL_PERMISSIONS`（contracts 中"被代码硬编码引用"的常量集）里的任一码
  不可删除；删除父目录时会检查**整棵子树**（`permissions.parent_id ON DELETE CASCADE`），
  子树含保留码则整体拒绝；
- 普通自定义权限可删；删除会**级联删除子树**（DB CASCADE）；
- 删除前收集**整棵子树影响到的用户**（含"仅绑定了后代权限"的用户），事务后统一
  `revokeAndRefreshAuthorization`——否则已删权限会在缓存 TTL 内继续授权（幽灵权限）；
- UI 应在确认弹窗展示影响面（角色/用户/子节点数，`GET /api/permissions/:id/impact`，见 §7.7）。

### 7.6 注册权限（REST — **经 Gateway 不可达**）

```
POST /api/permissions/register
```

**认证：** HTTP Basic（`Authorization: Basic base64(client_id:client_secret)`）；client 必须存在且
`ACTIVE`（否则 403 `AUTH_SSO_1003`），密钥校验失败同样 403；缺少/格式错误的 Basic 头 → 401
`AUTH_SSO_1002`。

**请求体（JSON）：**

```json
{
  "permissions": [
    { "code": "shop:order:list", "name": "订单列表", "type": "API", "parentId": null }
  ]
}
```

`permissions` 必须是数组（否则 400 `AUTH_SSO_1005`）；树内 `code` 重复 400；`code` 已被
**其他 client**（或 `client_id IS NULL` 的行）占用 → 409 `AUTH_SSO_6002`
（`PERMISSION_ALREADY_EXISTS`，消息会建议加 `{clientId}:` 前缀）。

**定位（2026-10-23 明确，决策 D4）：** Portal 内网机器接口，供客户端应用部署时同步自身权限树；
**不在 Gateway `public_paths` 白名单内**（`/api/auth/` 与 `/.well-known/` 之外都不在），
经唯一公网入口不可达——Gateway 会**剥离**客户端的 `Authorization`（Protected 路径），
随后按"无会话"判 401，属预期行为。**注意：该 401 来自 Gateway 的路径分类，不是 Portal 的
Basic 校验结果**；直连 Portal 时同一请求带有效凭证即成功。
`docs/spec/API.md` 旧版声称的"仅限 `is_internal=true` 的 Client"**没有实现依据**——
`clients` 表无 `is_internal` 列、代码也无该判断（审计 H-A-05）；该声明已删除。当前访问控制 =
"能直连 Portal 内网 + 持有有效 client 凭证"（代码里没有任何 `is_internal` 判断）。

**用途：** 批量注册/同步权限码；按 `client_id` 分区（`pg_advisory_xact_lock`），缺失的旧码置
`DISABLED`，`code` 冲突全局检查；有变更时失效权限读模型缓存。

**成功响应（200）：** `restSuccess(result)` 直出同步计数——

```json
{ "inserted": 3, "updated": 1, "deprecated": 0 }
```

（`deprecated` 计数本次被置为 `DISABLED` 的旧码个数；无变更时不会触发缓存失效。）

### 7.7 权限删除影响面（REST）

```
GET /api/permissions/:id/impact
```

**权限：** `portal:permission:delete` **或** `portal:permission:manage`（能删除的人才能看到影响面；
`withPermission` 满足其一即可）。
**源码：** `apps/portal/src/app/api/permissions/[id]/impact/route.ts`（此前本文档漏写该端点）

**行为：** 只读，供删除确认弹窗展示影响面；按 `WITH RECURSIVE` 递归整棵子树统计。

| 情形 | 响应 |
|---|---|
| `:id` 不是 UUID | 400 `AUTH_SSO_1005`（「权限 ID 格式不合法」） |
| 权限不存在 | 404 `AUTH_SSO_1004` |
| 正常 | 200，响应体直出（无 `data` 包裹） |

```json
{ "descendants": 4, "roles": 2, "users": 7 }
```

- `descendants`：整棵子树的后代节点数（**不含**自身）；
- `roles`：子树内任一权限被绑定的**去重角色数**；
- `users`：经由这些角色间接受影响的**去重用户数**（含"只绑定了后代权限"的用户）。
  这三个数字即 §7.5 删除时会被级联影响的规模。




---

## 8. 部门管理

**认证：** 所有端点需要 `portal_jwt_token`。

### 8.1 部门列表（REST）

```
GET /api/departments
```

**权限：** `portal:department:list`

### 8.2 创建部门（🔧 Server Action）

`createDepartmentAction` — 由 Portal 创建部门弹窗调用，权限 `portal:department:create`。

**根部门单例（2026-10-23 起，ADR-002 增补）：**

- 根部门（`parentId=null`）**全局唯一**，只在空树引导期由 seed/迁移建立；运行期创建第二个根
  被拒绝；
- 创建根目录时操作者还必须有非空数据范围（`targets=[]` 不得成为无守卫捷径）；
- 子部门：父部门须在操作者数据范围内；父级 `ancestors` 在事务内读取并计算，避免读-写竞争。

### 8.3 查看部门详情（REST）

```
GET /api/departments/:id
```

**权限：** `portal:department:read`

### 8.4 更新部门（🔧 Server Action）

`updateDepartmentAction` — 由 Portal 调用，权限 `portal:department:update`。

**约束：**

- 不能把父级设为自身或自身后代（环检测，业务码 `CANNOT_MOVE_TO_CHILD`）；
- **不能把已有部门迁出为根**（破坏根部门单例）；
- 移动时级联更新整棵子树的 `ancestors`：条件为 `ancestors = oldPrefix OR ancestors LIKE oldPrefix || '/%'`
  （等值分支漏掉会漏掉**直接子部门**——审计 H-B-02 的真实缺陷）；
- 目标父部门须在操作者范围内。

### 8.5 删除部门（🔧 Server Action）

`deleteDepartmentAction` — 由 Portal 调用，权限 `portal:department:delete`。

**约束（专属业务码）：** 根部门不可删（`CANNOT_DELETE_ROOT`）；有子部门不可删
（`DEPARTMENT_HAS_CHILDREN`）；有用户不可删（`DEPARTMENT_HAS_USERS`）；有角色不可删。
删除前判定顺序为：根 → 子部门 → 用户 → 角色（根部门检查在最前，不依赖"恰好有角色"的偶然保护）。

### 8.6 部门成员（REST）

```
GET /api/departments/:id/members
```

**权限：** `portal:department:read`

> **部门 `status=DISABLED` 的语义（2026-10-23 决策 D2）**：禁用是"管理动作开关"——禁止在
> 该部门下新建子部门/用户/角色、禁止把角色/用户迁入；**不追溯**既有用户的登录、授权与数据范围。
> 角色创建/迁移已实现 ACTIVE 校验；用户与子部门的同口径守卫为 backlog（详见 ADR-002 增补）。


---

## 9. 应用管理（OAuth Clients）

**认证：** 所有端点需要 `portal_jwt_token`。

### 9.1 应用列表（REST）

```
GET /api/clients
```

**权限：** `portal:client:list`

### 9.2 创建应用（🔧 Server Action）

`createClientAction` — 由 Portal 创建应用页调用，权限 `portal:client:create`。

**响应：** `{ clientId, clientSecret }`（以及成功 message）。**Secret 明文只在创建响应中出现一次**
（DB 只存 bcrypt hash）；UI 已在创建成功弹窗中展示并提供复制（H-C-03：此前 UI 丢弃该值，
导致新应用必须再走一次"轮换 Secret"才能使用）。

**per-client TTL 字段：** `accessTokenTtl` / `refreshTokenTtl`（秒）可选；创建后可编辑，签发时生效
并经服务端钳制（AT 60s–24h、RT 5min–30d），详见 §9.4 与 ADR-024。

### 9.3 查看应用详情（REST）

```
GET /api/clients/:id
```

**权限：** `portal:client:read`

### 9.4 更新应用（🔧 Server Action）

`updateClientAction` — 由 Portal 应用详情页调用，权限 `portal:client:update`。

**可编辑：** `name`、`redirectUris`、`scopes`、`homepageUrl`、`logoUrl`、`accessTokenTtl`、
`refreshTokenTtl`、`status`。**不可编辑 `clientSecret`**（必须走专门轮换动作）。

**TTL 语义（2026-10-23 起生效）：**

| 字段 | 默认 | 钳制边界 | 生效点 |
|---|---|---|---|
| `accessTokenTtl` | 3600s | 60s ~ 86400s（24h） | 新建的 AT `exp`、token 响应 `expires_in` |
| `refreshTokenTtl` | 604800s（7d） | 300s ~ 2592000s（30d） | 新 RT 行 `expires_at`、Cookie `max-age`、轮换后的新 RT |

缺失/非法值回退默认；越界收敛到边界。**不存在"每个 client 都能把 AT 拉长到 24h 以上"的配置面**——
更长需求须走全局部署评审（ADR-024）。

**已知边界：** 更新为事务内 read-modify-write，无 version/条件写；管理面低并发下接受丢失更新
（审计 H-27，P3，本轮不改）。

### 9.5 删除应用（🔧 Server Action）

`deleteClientAction` — 由 Portal 调用，权限 `portal:client:delete`。

**行为：** 删除 client 行；级联删除其 `permissions` / `role_permissions` / `authorization_codes` /
`refresh_tokens`（FK CASCADE）；权限读模型缓存会被同批失效（`permissions-list`，H-C-04）。

**已知边界（如实记录，ADR-013 决策 4）：** 已签发的 Access Token 是无状态 JWT，**不随 client 注销
被撤销**（无法按 client 定点撤 AT），最长在 AT TTL 内自然失效；急迫场景走用户级强制下线。
需求 G-CLT-D 的「所有已签发令牌自动撤销」应理解为"RT 续期能力被终止 + 已发 RT 级联删除"，
AT 残留是有意接受（`docs/spec/REQUIREMENTS_MATRIX.md` G-CLT-D 已注明）。

`portal` 自身 client 对管理面只读：修改/禁用/注销/轮换 Secret 一律被服务端 `guardPortalSelfClient`
拒绝（否则全站无法登录）。

### 9.6 轮换密钥（🔧 Server Action）

`rotateClientSecretAction` — 由 Portal 调用，权限 `portal:client:rotate_secret`。

**行为：** 生成强随机新 Secret，DB 只存 bcrypt hash，明文**仅在响应中返回一次**；旧 Secret
立即失效（下一次 client 认证即失败）。`portal` 自身 client 禁止轮换。

### 9.7 应用 Token 管理（REST）

```
GET    /api/clients/:id/tokens   — 查看该 client 的活跃 Refresh Token（分页）
DELETE /api/clients/:id/tokens   — 撤销该 client 名下 RT
```

**权限：**
- `GET /api/clients/:id/tokens` → `portal:client:read`
- `DELETE /api/clients/:id/tokens` → `portal:client:update`

**GET：** 返回该 client 名下的**活跃** RT（`revoked IS NULL AND expiresAt > now()`），
`restListSuccess` 分页；支持 `userId` 精确过滤。列表项字段：
`{ id, userId, username, scopes: string[], createdAt, expiresAt }`——`username` 取用户邮箱
（回退姓名），`scopes` 是空格分隔字符串**拆成数组**。

**DELETE：** `tokenIds`（字符串数组）或 `revokeAll=true`，至少给一个否则 400
`AUTH_SSO_1005`（「请提供 tokenIds 或 revokeAll」）；`tokenIds` 非数组同样 400；
malformed JSON → 400。只撤 RT（终止续期能力），返回**真实翻转计数**；审计 `TOKEN_REVOKE`
与撤销在**同一事务**内写入。成功响应形状特殊（`restSuccess` 带 `message` + `data`）：

```json
{ "message": "已撤销 3 个 Token", "data": { "revokedCount": 3 } }
```

**已知边界（ADR-006/ADR-013 决策 4）：** 本端点**不能**按 client 撤销 AT（AT 无持久化行、
无 client 语义），已发 AT 在 ≤1h TTL 内自然失效。

### 9.8 撤销 Token（🔧 Server Action）

`revokeClientTokensAction(clientId, tokenIds, revokeAll)` — 由 Portal 调用，权限
`portal:client:update`，审计 `TOKEN_REVOKE`；语义同 §9.7 DELETE，返回
`{ success: true, data: { revokedCount }, message }`。


---

## 10. 审计日志 API（REST）

**认证：** 需要 `portal_jwt_token`。

> **可见范围（2026-10-23 决策 D3）：** 持有 `portal:audit:read` 即可见**全量**审计/登录/访问日志
> （含所有部门的操作人与 IP/UA），**不按部门数据范围过滤**。这是"合规只读职能"的显式取舍：
> H-ACL-002 的数据范围约束只适用于业务数据（用户/角色/部门/权限/客户端），审计日志不在其列。
> 授予 `audit:read` 即等于授予"全公司安全日志可见权"，应只授给审计/安全角色。

### 10.1 登录日志

```
GET /api/audit/login-logs?page=1&pageSize=20&eventType=LOGIN_FAILED&startDate=2026-10-01&endDate=2026-10-23&userId=<uuid>
```

**权限：** `portal:audit:read`

**过滤：** `eventType` ∈ `LOGIN_EVENT_VALUES`（`LOGIN_SUCCESS|LOGIN_FAILED|LOGOUT|TOKEN_REFRESH|
TOKEN_REFRESH_FAILED`）；`startDate`/`endDate` 为 `YYYY-MM-DD`；`userId` 为 UUID。

> **非法值的真实行为（2026-10-23 按源码校正）：** 本路由对 `eventType` 做的是
> **白名单过滤**——不在 `LOGIN_EVENT_VALUES` 内的值被**静默忽略**（当未传处理），
> **不返回 400**；`startDate`/`endDate` 也由读模型的 `DATE_REGEX` 判定，格式不符时**忽略该条件**；
> `userId` 原样透传。只有 §10.4 的导出路由对非法日期/`userId` 显式 400。

### 10.2 操作日志

```
GET /api/audit/logs?page=1&pageSize=20&operation=USER_CREATE&startDate=…&endDate=…&userId=…
```

**权限：** `portal:audit:read`

**过滤：** `operation` ∈ `AUDIT_OPERATION_VALUES`（19 个值：`USER_CREATE`/`USER_UPDATE`/
`USER_DELETE`/`USER_ROLE_ASSIGN`/`ROLE_CREATE`/`ROLE_UPDATE`/`ROLE_DELETE`/`ROLE_PERMISSION_ASSIGN`/
`PERMISSION_CREATE`/`PERMISSION_UPDATE`/`PERMISSION_DELETE`/`DEPARTMENT_CREATE`/
`DEPARTMENT_UPDATE`/`DEPARTMENT_DELETE`/`CLIENT_CREATE`/`CLIENT_UPDATE`/`CLIENT_DELETE`/
`CLIENT_SECRET_REGENERATE`/`TOKEN_REVOKE`）；非法 `operation` **静默忽略**（同 §10.1）。

### 10.3 访问日志

```
GET /api/audit/access-logs?page=1&pageSize=20&userId=<uuid>&resourceType=…&resourceId=…
  [&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD]
```

**权限：** `portal:audit:read`（访问日志与审计日志同属安全查看范畴，**不新建权限码**）

**过滤参数（源码 `apps/portal/src/app/api/audit/access-logs/route.ts`）：**
`userId`、`resourceType`、`resourceId`、`startDate`、`endDate` 全部原样透传给读模型
`getAccessLogs`——本路由**不做**白名单校验（与 §10.1/§10.4 的 400 行为不同）。

### 10.4 CSV 导出

```
GET /api/audit/export?type=login|operation
  [&eventType=… | &operation=…]
  [&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&userId=<uuid>]
```

**权限：** `portal:audit:export`（与 `audit:read` 分离）

**行为（2026-10-23 修复 H-28）：**

- 登录日志列：`时间,用户,事件类型,IP地址,User-Agent,失败原因`；操作日志列：
  `时间,操作人,操作类型,目标资源,详情,IP地址`；
- 时间列输出 **ISO 8601**；`params`（jsonb）输出 **JSON 字符串**（修复前 `String(object)` →
  `[object Object]`，实测 5205/5238 行"详情"损坏）；
- 日期/用户筛选与列表同口径并**透传**到导出（修复前被丢弃）；
- 全量按页循环（每页 100 行），上限 **100,000 行**；CSV 含 BOM、RFC 4180 转义与公式注入防护。
- **规模实测（D11）**：5,238 行导出耗时 **138ms**（测试栈），当前实现足够；**>3 万行建议改流式**
  （现为全量驻留内存 + 串行分页），列为 backlog。导出上限/性能非本轮门禁。


---

## 11. Gateway 注入头

Gateway（Rust/Pingora）完成 JWT 离线验签后，向**受保护路径**的 Portal / 微服务注入以下身份头
（三者"同生共死"：验签通过一起注入，续签成功一起覆盖）：

| Header | 值 | 说明 |
|--------|-----|------|
| `Authorization` | `Bearer <JWT>` | 原始 Access Token，供 Portal 自行解码获取完整 claims |
| `X-User-Id` | `<uuid>` | 用户 ID（取自 JWT `sub`），子系统据此查 Redis 获取权限上下文 |
| `X-User-Jti` | `<uuid>` | JWT 唯一标识（取自 JWT `jti`），用于审计与吊销追踪 |

> **Public 路径例外（2026-10-23 更正，ADR-010 更正段）**：对于白名单 Public 路径
> （`/api/auth/*`、`/.well-known/*` 等），Gateway **保留客户端自带的 `Authorization`**
> 并**不注入** `X-User-Id`/`X-User-Jti`/`X-Gateway-*`。这样标准 OIDC 客户端（Basic）
> 与 userinfo 的 Bearer 才能经唯一入口工作；Portal 对该 Bearer 走自验签（含 jti 黑名单
> fail-close），撤销语义不降级。
>
> 零信任净化在 Protected/Microservice/Static 路径不变：无论是否通过验签，先**强制移除**
> 客户端可能伪造的身份头（`Authorization`、所有 `X-*` 除显式代理标准头），再按验签结果
> 权威注入。2026-10-23 起还纳入 `Forwarded` 与 `Proxy-Authorization`，并对
> `/_next/../`、`%2e%2e` 等 dot-segment 路径在入口直接返回 400（防限流/验签绕过）。
>
> **注意**：用户名、邮箱、部门 ID 列表（`deptIds`）等扩展属性**不在网关注入头中**。这些数据由
> Portal 在令牌签发时预热至 Redis 的 `UserPermissionContext`（Key:
> `portal:user_perms:{userId}`；注意 `deptIds` 未展开子树，见 §4.2），子系统通过
> `X-User-Id` 向 Redis 查询获取。详见 [`third-party-integration.md`](./third-party-integration.md)。

---

## 12. 错误码附录

**唯一真相源：`packages/contracts/src/errors.ts` 的 `ERROR_CODE_VALUES`**（7 个分组的并集，闭合联合类型
`ErrorCode`）；本文档的每一行都由守卫测试
`apps/portal/__tests__/api/docs-api-error-codes.test.ts` 与契约**双向机械对齐**
（键与线值必须都相等；文档里出现的任何 `AUTH_SSO_<n>` 都必须是真实线值）。
**不做重编号**：已删除的码（`1001`/`1007`/`2001`/`2020`/`3001`/`4001`/`5001`/`6001`/`7001`…）
的空洞**永久保留**，复用会让历史日志与客户端配置产生歧义。

### 12.1 通用（`COMMON_ERRORS`，1xxx）

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `AUTH_SSO_1002` (UNAUTHORIZED) | 401 | 未认证（含 Access Token 过期或已撤销——#82 后不再有独立的过期/撤销码） |
| `AUTH_SSO_1003` (FORBIDDEN) | 403 | 无权限 / 超出数据范围 |
| `AUTH_SSO_1004` (NOT_FOUND) | 404 | 资源不存在（**所有**资源统一用此码：资源类型由 URL 表达，实体级 not-found 码不增加信息） |
| `AUTH_SSO_1005` (VALIDATION_ERROR) | 400 / 422 / 409 | 通用码，状态由错误类决定（见 §1.3）：参数校验 400、领域规则 422、未登记的唯一约束 409 |
| `AUTH_SSO_1006` (INTERNAL_ERROR) | 500 | 服务器内部错误 |
| `AUTH_SSO_1008` (RATE_LIMITED) | 429 | 请求频率超限（登录 **IP 维度**，ADR-025；响应带 `Retry-After`）。与 423 的账户×IP 锁定是两件事 |

### 12.2 认证与 OIDC（`AUTH_ERRORS`，2xxx）

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `AUTH_SSO_2002` (INVALID_CREDENTIALS) | 401 | 邮箱或密码错误（用户不存在亦同形，防枚举） |
| `AUTH_SSO_2003` (ACCOUNT_DISABLED) | 403 | 账户已被管理员禁用 |
| `AUTH_SSO_2004` (ACCOUNT_LOCKED) | 423（Redis 暴力破解锁定）/ 403（`users.status=LOCKED` 或 `DELETED`） | 账户已锁定。同一码两种来源：423 来自 §2.1 的失败计数窗口；403 来自用户状态机。`DELETED` 刻意复用它以防状态枚举 |
| `AUTH_SSO_2024` (REFRESH_TOKEN_INVALID) | 401 | Refresh Token 无效或已过期（清两个 Cookie） |
| `AUTH_SSO_2025` (REFRESH_TOKEN_MISSING) | 401 | 缺少 Refresh Token Cookie |
| `AUTH_SSO_2032` (INVALID_CODE) | 400 | 授权码无效/已使用/已过期/`redirect_uri` 不匹配（OAuth 层映射为 `invalid_grant`） |
| `AUTH_SSO_2033` (OAUTH_INVALID_REDIRECT_URI) | 400 | OIDC 授权流程中 redirect_uri 不在注册白名单（**唯一**的 redirect_uri 错误码） |
| `AUTH_SSO_2034` (PKCE_VERIFICATION_FAILED) | 400 | PKCE `code_verifier` 与 `code_challenge` 不匹配（映射为 `invalid_grant`） |
| `AUTH_SSO_2035` (INVALID_CLIENT) | 401 | Client 不存在/已停用/密钥不匹配（映射为 `invalid_client`） |
| `AUTH_SSO_2036` (UNSUPPORTED_GRANT_TYPE) | 400 | 不支持的 `grant_type`（映射为同名 OAuth 错误） |
| `AUTH_SSO_2037` (INVALID_SCOPE) | 400 | scope 超出 Client 注册范围（映射为 `invalid_scope`） |

### 12.3 用户（`USER_ERRORS`，3xxx）

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `AUTH_SSO_3002` (USER_ALREADY_EXISTS) | 409 | 用户已存在（复合/无法定位具体列时的实体级回退码） |
| `AUTH_SSO_3003` (USERNAME_ALREADY_EXISTS) | 409 | 用户名已存在 |
| `AUTH_SSO_3004` (EMAIL_ALREADY_EXISTS) | 409 | 邮箱已存在（邮箱经规范化比较，大小写变体同码） |
| `AUTH_SSO_3005` (MOBILE_ALREADY_EXISTS) | 409 | 手机号已存在 |
| `AUTH_SSO_3007` (PASSWORD_TOO_WEAK) | 422 | 密码不满足策略 |
| `AUTH_SSO_3008` (CANNOT_DELETE_SELF) | 422 | 不能删除自己 |
| `AUTH_SSO_3009` (CANNOT_DISABLE_SELF) | 422 | 不能禁用自己（自己处于禁用态时"启用自己"允许） |

### 12.4 部门（`DEPARTMENT_ERRORS`，4xxx）

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `AUTH_SSO_4002` (DEPARTMENT_ALREADY_EXISTS) | 409 | 部门编码已存在 |
| `AUTH_SSO_4003` (DEPARTMENT_HAS_CHILDREN) | 422 | 有子部门不可删 |
| `AUTH_SSO_4004` (DEPARTMENT_HAS_USERS) | 422 | 有用户不可删 |
| `AUTH_SSO_4005` (CANNOT_DELETE_ROOT) | 422 | 根部门不可删 |
| `AUTH_SSO_4006` (CANNOT_MOVE_TO_CHILD) | 422 | 不能把父级设为自身或自身后代 |

### 12.5 角色（`ROLE_ERRORS`，5xxx）

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `AUTH_SSO_5002` (ROLE_ALREADY_EXISTS) | 409 | 角色编码已存在 |
| `AUTH_SSO_5003` (CANNOT_DELETE_SYSTEM_ROLE) | 422 | 系统内置角色不可删 |
| `AUTH_SSO_5004` (CANNOT_MODIFY_SYSTEM_ROLE) | 422 | 系统内置角色不可改 |

### 12.6 权限（`PERMISSION_ERRORS`，6xxx）与 Client（`CLIENT_ERRORS`，7xxx）

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `AUTH_SSO_6002` (PERMISSION_ALREADY_EXISTS) | 409 | 权限 `code` 已被占用（`/api/permissions/register` 的跨 client 冲突也用此码） |
| `AUTH_SSO_7002` (CLIENT_ALREADY_EXISTS) | 409 | `client_id` 已存在 |

> **OAuth 端点的错误体不使用上表**：`token` / `introspect` / `revoke` / `userinfo` 返回
> RFC 6749 §5.2 / RFC 7662 / RFC 7009 / RFC 6750 的错误名（`invalid_request` / `invalid_client` /
> `invalid_grant` / `invalid_scope` / `unsupported_grant_type` / `invalid_token` /
> `insufficient_scope` / `server_error`）。内部码 → OAuth 错误名的映射单点在
> `apps/portal/src/domain/shared/error-mapping.ts` 的 `mapToOAuthError`，未登记码回落
> `invalid_request`。**唯一例外**：`authorize` 端点的本地错误页（`/oauth/error?error=…`）用的是
> OAuth 错误名而非内部码。


---

## 13. 子应用接入指南

### 13.1 Gateway 代理模式（推荐）

Gateway（Rust/Pingora）统一承担 OAuth 2.1 Client 角色。子应用通过 Gateway 代理后只需：

```typescript
// 1. 读取 Gateway 注入的身份头
const userId = request.headers.get('x-user-id');

// 2. 查询 Redis 获取权限上下文
const perms = await redis.get(`portal:user_perms:${userId}`);
```

不要求子应用实现 OIDC、管理 Session 或验签 JWT。详见 `docs/INTEGRATION_GUIDE.md`。

### 13.2 标准 OIDC 集成流程（适用于非 Gateway 代理的场景）

对于无法通过 Gateway 代理的第三方系统（如 SaaS 应用）：

1. 在 Portal 管理后台注册 OAuth 应用，获取 `client_id` + `client_secret`
2. 配置 Redirect URI（白名单）
3. 实现 Authorization Code + PKCE 流程
4. 使用 Token 端点换取 Access Token
5. 使用 UserInfo 端点获取用户信息
6. 定期刷新 Token（POST /api/auth/refresh 或 POST /api/auth/oauth2/token）

---

## 14. 限流策略

**唯一实施层是 Gateway**（`apps/gateway/src/rate_limiter.rs`，Pingora 滑动窗口，进程内静态计数器）。
源码的路径谓词是 `path.starts_with("/api/auth/")`——**整个 `/api/auth/*` 共用同一个计数器**，
不是"login 与 refresh 两个端点"；除 `token` 之外的精确匹配分支只有一个：

| 路径 | 限制（默认） | 窗口 | 实施层 | 配置 |
|------|------|------|--------|------|
| `GET/POST /api/auth/oauth2/token` | 30 次/IP | 1 分钟 | Gateway | `RateLimitConfig.token_max` |
| 其余 `/api/auth/*`（login、refresh、logout、authorize、userinfo、introspect、revoke、jwks …） | 20 次/IP | 1 分钟 | Gateway | `RateLimitConfig.auth_max` |
| 其它路径（含全部管理 API） | **不限流** | — | — | 返回 `RateDecision::Untracked`，不触碰计数器 |

> **2026-10-23 按源码校正两点：**
> 1. 本文档旧版写的"管理 API 写操作 100 次/分钟，实施层 Portal"**在代码里不存在**：
>    `apps/portal/src/proxy.ts` 只做 CSRF 同源校验与登录重定向，没有任何限流；全仓也没有
>    第二个限流器。管理 API 的滥用防护目前只有 `withPermission` 的鉴权与 Vitest 层的角色约束。
> 2. "共享计数器"的范围是**整个 `/api/auth/` 前缀**（含 userinfo / jwks / introspect），不只
>    login 与 refresh——OIDC 机器端点的高频轮询会挤占同一额度。
>
> 阈值可经 `RATE_LIMIT_*` 环境变量覆盖；Gateway 为单容器进程内限流，多实例部署时实际阈值按实例数
> 线性放大（跨实例不共享计数）。
> 限流计数以**入口原始路径**为准，但 2026-10-23 起含 dot-segment（`.`/`..`、`%2e` 变体）的路径
> 在入口直接 400，不能再用 `/_next/../api/auth/login` 之类路径绕过限流或验签（审计 H-D-03）。

超出限制返回 **429 Too Many Requests**（`session.respond_429(60)`，带 `Retry-After: 60`），
并计入指标 `metrics::inc_rate_limited()`。


---

## 15. 机器端点的入口行为（2026-10-23 补充）

### 15.1 Public 路径白名单（`public_paths`）的**确切**集合

Gateway 的路径分类来自 `[[upstreams]].public_paths`。**验收栈**（`apps/gateway/gateway.e2e.toml`，
`pnpm test:e2e` 起的就是它）里 `/` upstream 的白名单只有 7 项：

```
"/", "/login", "/oauth/error", "/api/auth/", "/.well-known/", "/_next/", "/favicon.ico"
```

`gateway.docker.toml` 的生产默认值多出 `/register`、`/error`、`/oauth2/` 三项。**两份都不含**
`/api/permissions/`——所以 §7.6 的 register 端点经公网入口必然 401，而 §2.5 的 `/api/health`
也不在白名单内（经 Gateway 访问属 Protected 路径，会先被验签门拦下；容器健康检查应直连 Portal）。

> 结论：**"Public 路径"= 上面这张清单**，不是"所有 `/api/` 前缀之外的路径"，也不包含
> `/api/me`、`/api/users` 等管理端点。

### 15.2 行为表（逐条对应 `tests/e2e/oidc-machine-endpoints.spec.ts`）

| 场景 | 经 Gateway（唯一公网入口）行为 | e2e 断言 |
|---|---|---|
| `POST /api/auth/oauth2/token` + `client_secret_basic`（假 code） | 客户端 `Authorization` 原样到达 Portal；客户端认证通过后因 code 无效返回 **400 `invalid_grant`**。若网关把 Basic 剥掉则变成 401 `invalid_client`——这正是该用例的回归信号 | 断言 `status === 400` **且** `body.error === 'invalid_grant'`（比只看状态码更能定位根因） |
| `GET /api/auth/oauth2/userinfo` 无凭据（干净 API 上下文，无 Cookie） | **401**（网关不得因 Public 路径放行而注入空身份） | `status === 401` |
| `GET /api/auth/oauth2/userinfo` + `Authorization: Bearer <真实 AT>`（浏览器登录闭环取得的 AT） | **200** + `sub` 非空；Portal 自验签（含 jti 黑名单），登出后同一 AT → 401 | `status === 200` **且** `body.sub` 为真 |
| `POST /api/auth/oauth2/introspect` + Basic（`token=<真实 AT>`） | 正常到达 Portal：**200 `active: true`** + `sub` | `status === 200`、`active === true`、`sub` 为真 |
| `POST /api/auth/oauth2/revoke` + Basic | 正常到达 Portal；归属校验见 §3.7（成功恒 `200 {}`） | 本条由 §3.7 的归属语义覆盖，e2e 未单独断言 |
| `POST /api/permissions/register` + Basic | **401**（不在 Public 白名单 ⇒ 网关剥离 `Authorization` 后按 Protected 判无会话；定位为内网直连，见 §7.6） | 由 §7.6 与审计脚本覆盖 |
| Protected 路径（如 `GET /api/users`）+ 伪造 `Authorization`/`X-User-Id`/`X-User-Jti`/`X-Gateway-*` | 身份头被**剥离**；无 Cookie ⇒ **401**（修 H-D-01 不得放宽此处） | `status === 401` |
| 含 dot-segment 的路径（任意方法） | 400（防限流/验签前缀绕过） | — |
| `/healthz`（Gateway 自身） | 仅 GET/HEAD 返回 `ok`；其它方法 405 + `Allow`；自产响应带 HSTS | — |

**该 spec 的两个前提，读它在解读时很重要：**

1. 所有机器端点断言都用**独立 `APIRequestContext`（不带浏览器 Cookie）**，确保验证的是
   `Authorization`/Basic 凭证通道——`userinfo` 支持 Cookie 回退（§3.5），复用浏览器上下文
   会掩盖网关剥离问题。
2. 检查的是**错误码**而不只是状态码：`401 invalid_client` 与 `400 invalid_grant` 在状态码层面
   都是 4xx，但前者意味着凭证通道被网关切断。

上述行为由 `tests/e2e/oidc-machine-endpoints.spec.ts` 与审计复现脚本
（`.zcode/audit/review/A-L01/`、`.zcode/audit/gateway/18-p1-authorization-strip.txt`）钉住。

