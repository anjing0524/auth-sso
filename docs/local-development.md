# 本地开发（Portal UI）

> 适用范围：改 Portal 页面/交互时的快速迭代。完整 OIDC、Gateway 验签、跨服务 E2E 仍以 Docker 验收栈为准。

## 工具链（2026-10-29 实测）

| 项 | 本地 | Portal 镜像 |
|---|---|---|
| Node | v26.12.1 | v26.13.0 (`node:26-alpine`) |
| pnpm | 12.14.0 | 12.14.0（`docker/images/portal.Dockerfile` 已对齐） |
| Rust | 1.93 | 1.93（gateway 镜像） |

镜像并不旧；此前唯一落后点是 Dockerfile 把 pnpm 固定为 10.12.4，已改为 12.14.0。

## 启动本机 Portal

```bash
# 1. 本地基础设施
docker compose -f docker/compose/local.yml up -d

# 2. 初始化本地库（首次）
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/auth_sso \
  pnpm --filter @auth-sso/portal db:migrate
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/auth_sso \
  pnpm --filter @auth-sso/portal db:seed

# 3. 启动 Next dev（4100，热更新）
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/auth_sso \
REDIS_URL=redis://localhost:6379 \
NEXT_PUBLIC_APP_URL=http://localhost:4100 \
PORTAL_ISSUER=http://localhost:4100 \
  pnpm --filter @auth-sso/portal dev
```

打开 `http://localhost:4100`。UI 改动由 Next dev 热更新，不需要 `next build`、docker cp 或重启容器。

## 本地认证边界

`/dashboard` 等页面依赖 `portal_jwt_token`。完整登录链路是 **Gateway → Portal OAuth**；直接访问 4100 只能做未登录页面/组件开发。需要本地已登录页面时，二选一：

1. 本地启动 Gateway（生产链路同构）；或
2. 验收栈登录后，把 `portal_jwt_token` / `portal_refresh_token` cookie 回放到 `http://127.0.0.1:4100`（数据库与 JWKS 需与验收栈一致）。

仅用于本地 UI 联调，不要把回放 cookie 的方式带入生产或提交到仓库。

## 该用哪种方式

- 改样式、交互、文案、表格高度：本地 4100。
- 改 Server Action / OIDC / Gateway / 会话安全：Docker 验收栈 + 对应 API/E2E。
- 每个里程碑仍跑完整回归；日常不要为一行 UI 改动重建镜像。
