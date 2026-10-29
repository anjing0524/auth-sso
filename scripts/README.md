# scripts/ 脚本索引

> 本目录只放**必须用脚本表达**的编排：多步骤、跨服务、需要清理/断言。
> 能用标准命令直接表达的，不再包一层脚本。

## 目录与职责

| 目录 | 职责 | 脚本 |
|---|---|---|
| `local/` | 本地原生开发 | `dev.sh`（本地 PG18/Redis8 + migrate + Next dev；`--reset` 清库重 seed） |
| `docker/` | 生产部署 | `deploy.sh`（生产校验/构建/migrate+seed/健康检查/回滚） |
| `e2e/` | 验收闭环 | `release.sh`（`pnpm test:e2e`：直接 compose 构建/启动 → Playwright → 清理）、`acme-e2e.sh`、`acme-staging.sh` |
| `ci/` | CI 专用 | `verify.sh`、`acme-preflight.sh`、`e2e.sh`（直接 compose + Playwright 容器） |
| `bench/` | 性能基准 | `gateway.mjs` |
| `ux/` | 交互/可访问性测量 | `a11y.mjs`、`cwv.mjs`、`measure.mjs` |

## 入口

```text
本地开发     pnpm dev  [-- --reset]
本机测试     pnpm test
验收闭环     pnpm test:e2e
生产部署     pnpm deploy [-- --check|--status|--rollback]
验收栈排查   docker compose -f docker/compose/test.yml <build|up|ps|logs|down>
```

## 归属规则

- **只有多步编排才配脚本**：单条 `docker compose` / `pnpm` 能完成的，不新增包装。
- **验收栈由 Compose 直接管理**：构建、启动、状态、日志、停机都用标准 `docker compose -f docker/compose/test.yml`；
  只有“构建/启动 → Playwright → 清理”这一整套闭环放在 `e2e/release.sh`。
- **生产部署需要一个安全入口**：`docker/deploy.sh` 负责环境校验、镜像备份、健康检查、回滚；这是有状态操作，不是纯包装。
- **CI 脚本只被 workflow 调用**；本地与 CI 用同一份 compose、同一服务列表、同一 base URL。
- 脚本先解析仓库根，不依赖调用者 cwd；失败必须非零退出。

## 与 Docker 配置的关系

`docker/` 放声明式配置（compose / Dockerfile / ACME fixtures / 文档），本目录放命令式编排；
验收栈说明见 [`docker/README.md`](../docker/README.md) §7。
