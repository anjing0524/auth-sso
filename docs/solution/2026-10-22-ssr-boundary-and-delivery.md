# Next.js 服务端/客户端边界、权限准确性与交付链路（2026-10-22）

> 触发（用户）：“结合 Next.js/React 最新特性，哪些是服务端、哪些是客户端；UI/UX 更顺手、权限更准确、
> Gateway 更高效；模拟真实场景、创建测试用例、走通每条链路，交付最终代码/文档/部署脚本。”
>
> 本轮交付四块：① 服务端→客户端权限快照（消除客户端二次请求与首帧抖动）；② 权限读取的
> “职责匹配”（分配角色不应要求角色管理权限）；③ Gateway 存活探针 + 可复现基准；④ 生产部署补齐
> 迁移/seed、健康检查、内网数据库与一键部署脚本。

## 1. Next.js 16 / React 19 边界：身份与权限只过一次边界

### 现状问题

`(dashboard)/layout.tsx` 已经在服务端取到并用于菜单过滤的权限上下文，但客户端
`PermissionGuard` 又通过 `usePermissions()` 发 `GET /api/me/permissions`：

1. 每个会话一次多余请求（同一份数据服务端已持有）；
2. `loading=true` 首帧 ⇒ 所有受保护按钮渲染为 `null`，请求返回后才出现（布局抖动）；
3. 权限数据到达前，受保护入口不在 SSR HTML 中（渐进增强/无 JS 场景直接缺失）。

### 修复

- 新增 `components/providers/permissions-provider.tsx`（Client Component，仅传两个可序列化数组
  `roleCodes/permissionCodes`）；判定继续委托 `@auth-sso/contracts` 的 `can/hasRole/isAdminRole`。
- `(dashboard)/layout.tsx` 用 `<PermissionsProvider>` 包住 `DashboardLayout` 与 `children`。
- `hooks/use-permissions.ts` 优先读 Provider 快照（**同步、零请求**）；不在 Provider 内时才走旧的
  `/api/me/permissions` 兜底（独立组件/测试），生产布局不会触发。

### 实测证据

| 项 | 修复前 | 修复后 |
|---|---|---|
| 后台导航期间 `/api/me/permissions` 请求数 | 每会话 1 次 | **0** |
| 受保护按钮是否在 SSR HTML | 否（首帧 null） | **是**（`新建用户`/`分配角色` 均在首包 HTML） |
| 权限判定 | 异步 loading | Provider 内同步、`loading=false` |

新增单测 `__tests__/components/permissions-provider.test.tsx`：快照注入、零 fetch、管理员绕过、
无权限隐藏（2 例）。`/api/me/permissions` 端点保留给外部消费者，后台 UI 不再依赖它。

### 边界清单（本轮判断）

| 层 | 职责 | 例子 |
|---|---|---|
| Server Component / Server Action | 数据读取、权限、分页、写操作、审计 | 各列表 `page.tsx + data.ts`、`actions.ts`、OAuth/OIDC route handlers |
| Client Component | 仅交互与浏览器状态（弹窗、受控表单、乐观更新、剪贴板） | 各 Table/Dialog/Filter、`PermissionsProvider` |
| 客户端按需 fetch（保留） | **用户触发**的对话框候选数据（打开才请求，避免把全量权限/角色塞进每个页面首包） | 配置权限、分配角色、部门成员、应用 Token 列表 |
| 反模式（已消除） | 客户端为“身份/权限”这种服务端已持有的数据再发请求 | `/api/me/permissions` 在布局内调用 |

边界原则（写入 DESIGN）：**身份/权限快照只在服务端→客户端传递一次；列表数据服务端取；
写操作走 Server Action；客户端 fetch 仅限用户触发且需要新鲜数据的面板。**

## 2. 权限更准确：让读取权限与操作权限匹配

`分配角色` 对话框需要两份数据：

- 候选角色：`GET /api/roles` —— 之前只认 `role:list`；
- 已绑定角色：`GET /api/users/:id/roles` —— 之前只认 `user:read`。

一个只被授予 `user:assign_role` 的操作员（最小权限原则下的合理角色）打开对话框会拿到 403 空列表，
UI 表现为“没有可分配角色”而不是权限错误。修复为**任一匹配**：

- `/api/roles`：`role:list` **或** `user:assign_role`；
- `/api/users/:id/roles` GET：`user:read` **或** `user:assign_role`。

写路径仍只认 `user:assign_role`；数据范围、同部门约束（R-USER-ROLE）不变。

## 3. Gateway 更高效：存活探针 + 可复现基准

### 3.1 新增 `/healthz`（网关自身 liveness）

此前没有网关级健康端点，部署/负载均衡只能探 `/login`（要穿过 TLS + OAuth 链路 + Portal）。
新增 `GET /healthz`：在 `request_filter` 最前面直接返回 `200 ok`，**不查 Redis、不访问 Portal**；
上游故障时不会把 Gateway 误判为不健康。纯函数 `is_health_path` + 单测（精确路径、拒绝 `/healthz/`）。

`scripts/deploy.sh` 现在先等 `/healthz`，再等 `/login`（首次 ACME 签发可能较慢）。

### 3.2 实测（`node scripts/bench-gateway.mjs --n 300 --c 30`）

| 路径 | 成功 | RPS | p50 | p95 |
|---|---|---|---|---|
| `/healthz`（网关自身） | 300/300 | 1797 | 16.75ms | 19.21ms |
| `/login`（Gateway→Portal 流式 HTML） | 300/300 | 154 | 186.41ms | 320.74ms |
| `/_next/static/...js`（网关 Static 放行） | 300/300 | 1959 | 13.34ms | 25.17ms |

结合 curl 验收：网关已启用 **HTTP/2**、gzip、静态资源 `immutable` 缓存 + 静态分类跳过验签/限流、
Redis 连接池。本轮未引入“JWT/jti 结果缓存”这类优化：jti 黑名单是吊销的即时语义，缓存会引入
撤销窗口，收益（省一次 Redis EXISTS）与安全/一致性代价不匹配；如未来需要，应作为显式安全决策评审。

## 4. 可交付部署：补齐生产链路 + 一键脚本

审计 `docker-compose.prod.yml` 发现三处会直接影响交付的缺口：

1. PostgreSQL **发布 5432 到宿主机**（DOCKER.md 声称仅内网）——改为 `expose`，仅 Compose 网络可达；
2. **没有迁移/seed 服务**：首次 `up -d --build` 后 Portal 面对空 schema——新增一次性 `db-init`
   （`pnpm db:migrate && pnpm db:seed`，幂等），Portal `depends_on: service_completed_successfully`；
3. Portal/Gateway 没有健康检查与启动依赖——新增 Portal `/api/health` healthcheck、
   redis healthcheck、Gateway 等 Portal healthy 再启动。

新增 `scripts/deploy.sh`（唯一推荐入口）：

| 模式 | 行为 |
|---|---|
| `--check` | 校验 `.env.prod` 必填项/HTTPS URL/域名 + `docker compose config`，不启动容器 |
| 默认 | 备份旧镜像为 `:previous` → 构建 → `up -d`（db-init 先迁移/seed）→ 等 Portal/Gateway 健康 |
| `--no-build` | 使用现有镜像部署 |
| `--status` / `--down` | 查看状态 / 停止（保留数据与 ACME 卷） |
| `--rollback` | 切回 `:previous` 镜像并重启；**明确不自动回退数据库**，提示先备份 |

实测：`ENV_FILE=/tmp/... ./scripts/deploy.sh --check` 通过（配置合法、未启动）；`bash -n` 通过。
`DOCKER.md` §3/§4 已更新为脚本路径，补充回滚/备份边界与生产凭据清单。

## 4.1 权限删除影响面（UX/权限准确性补充）

权限删除是级联的（子菜单 + role_permissions），原确认弹窗只写了一句泛泛的“绑定会清除”，
管理员无法判断影响范围。新增只读影响面：

- 读模型 `getPermissionDeletionImpact`：一条递归 CTE 统计后代节点、受影响角色（去重）、
  通过这些角色间接受影响的用户（去重）；
- `GET /api/permissions/[id]/impact`（`permission:delete` 或 `permission:manage`，非法 UUID → 400、不存在 → 404）；
- 删除确认弹窗按需加载并显示“影响 N 个角色、N 个用户，并级联删除 N 个子菜单”；
  加载失败不阻断删除（辅助信息）。
- 测试：`permission-api.test.ts` 新增 3 例（计数/404/400）；浏览器实测删除 `portal:user:list`
  显示“2 个角色、1 个用户”。

## 4.2 发布验收 E2E 纳入 SSR 边界回归

`tests/e2e/ssr-permission-snapshot.spec.ts`（已提交，CI 运行）：
- Gateway `/healthz` 返回 200 `ok` 且 `Cache-Control: no-store`；
- 管理员登录后访问 `/users`：断言导航期间 **不出现** `/api/me/permissions` 请求，
  受保护按钮（新建用户/分配角色）可见。
`scripts/stack.sh e2e` 从“只跑 docker-release.spec.ts”改为跑 `tests/e2e` 全部 spec（3 例）。

## 5. 验证

| 项 | 结果 |
|---|---|
| 权限快照单测 | 2/2（零 fetch、同步判定、管理员绕过、无权限隐藏） |
| 后台导航 `/api/me/permissions` 请求 | 0 |
| SSR HTML 受保护按钮 | 存在（`新建用户`、`分配角色`） |
| Gateway `/healthz` | 200 + 单测通过，clippy 0 warning，169 个 Rust 测试通过 |
| Gateway 基准 | 300/300 成功；healthz p50 16.75ms、静态 p50 13.34ms（见上表） |
| 生产部署配置 | `docker compose config --quiet` 通过；`deploy.sh --check` 通过 |
| 权限 UI 端到端自查 | 16/16（见 `2026-10-21-permission-design-audit.md` §9.1，本轮重跑仍全过） |
| 回归 | `pnpm test`、lint、typecheck、e2e 见最终门禁输出 |

## 6. 保留判断 / 下一轮候选

- Gateway 进一步优化（TLS session cache 参数、JWKS 刷新策略、连接池参数）需要压测环境与安全评审，
  本轮只做无风险的健康探针与基准工具，不引入会改变吊销语义的缓存。
- 对话框按需 fetch 仍是客户端请求，这是有意的“用户触发才加载”；若要做成服务端预取，需要
  评估首包体积与权限范围（候选角色/权限可能很大），暂不合并进布局首包。
- 生产部署脚本未做自动数据库备份/恢复；`--rollback` 只回镜像。若要做“一键回滚含数据”，
  需要引入备份目录与版本化迁移策略，属于运维流程设计。
