# 本地开发（原生启动）

> **本地就是本地启动**：Portal 在宿主机跑 `next dev`（4100），PostgreSQL/Redis 由本地 Compose 提供；
> Docker 验收栈与生产部署是另外两条命令，不混用。

## 工具链

| 项 | 版本 |
|---|---|
| Node.js | 26（`>=26.0.0`） |
| pnpm | 12.14.0 |
| Rust | 1.99（仅本地运行 Gateway 时需要） |
| PostgreSQL | 18（本地 Docker） |
| Redis | 8（本地 Docker） |

## 快速启动

```bash
pnpm install          # 首次
pnpm dev:reset        # 首次/需要清空本地数据：删本地卷 + migrate + seed
pnpm dev              # 启动本地 PG/Redis + migrate + Next dev（4100）
```

打开 `http://localhost:4100`。种子管理员：`admin@example.com` / `Admin@123456`。

`pnpm dev` 只做本地开发，**不是验收**：

- 本地基础设施：`docker compose -f docker/compose/local.yml`（PG18 + Redis8）；
- 只启动 Portal；不启动 Gateway；
- 启动日志出现 Next dev 的 `Ready` 后访问 4100。

## 常用命令

| 命令 | 用途 |
|---|---|
| `pnpm dev` | 本地原生启动（infra up + migrate + Next dev） |
| `pnpm dev:reset` | 清空本地数据卷并 migrate + seed（不影响验收/生产） |
| `pnpm dev -- --no-migrate` | 跳过迁移直接启动 |
| `pnpm stack up` / `pnpm stack down` | Docker 验收栈（自签证书，19443） |
| `pnpm test` | Vitest 全量测试 |
| `pnpm test:e2e` | Docker 验收栈上的 Playwright E2E |
| `pnpm deploy` | 生产部署；`-- --check` / `-- --status` / `-- --rollback` 为子模式 |

## 本地认证边界

`/dashboard` 等页面依赖 `portal_jwt_token`。完整登录链路是 **Gateway → Portal OAuth**；
直接访问 4100 只能做未登录页面/组件开发。需要本地已登录页面时：

1. 本地启动 Gateway（需 Rust 1.99）；或
2. 验收栈登录后，把 `portal_jwt_token` / `portal_refresh_token` cookie 回放到
   `http://127.0.0.1:4100`（数据库与 JWKS 需与验收栈一致）。

仅用于本地 UI 联调，不要把回放 cookie 的方式带入生产或提交到仓库。

## 该用哪种方式

- 改样式、交互、文案、表格：`pnpm dev`（本地 4100）。
- 改 Server Action / OIDC / Gateway / 会话安全：Docker 验收栈 + 对应 API/E2E。
- 上线/回滚：`pnpm deploy [flags]`（自托管生产，见 [`docker/README.md`](../docker/README.md) §0–§6）。
