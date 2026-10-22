# Docker Compose 入口收敛

## 问题

仓库里同时存在：

- `docker-compose.yml`：本地 PostgreSQL/Redis
- `docker-compose.local.yml`：本地全栈验证
- `docker-compose.ci.yml`：CI 的 `node-test` + PostgreSQL/Redis
- `docker-compose.e2e.yml`：Gateway 发布验收私有栈
- `docker-compose.prod.yml`：部署用途

其中真正被当前脚本和工作流消费的，只有三种职责：

1. 本地开发时启动数据库/Redis。
2. CI 中在容器内执行 lint/typecheck/migrate/seed/test。
3. 发布验收时启动 Gateway 闭环拓扑并跑浏览器测试。

`docker-compose.local.yml` 没有消费者；`docker-compose.ci.yml` 与 `docker-compose.e2e.yml` 虽名字不同，但本质上都在为“测试 + 构建发布拓扑”服务，只是一个只用到了 `node-test`，另一个只用了 `db-init/portal/gateway`。

## 决策

- 保留 `docker-compose.yml`，职责收敛为本地开发数据库/Redis 基础设施。
- 保留 `docker-compose.prod.yml`，职责保持为部署编排。
- 删除 `docker-compose.local.yml`。
- 合并 `docker-compose.ci.yml` 与 `docker-compose.e2e.yml` 为统一的 `docker-compose.test.yml`：
  - `node-test` 服务用于 CI 的 lint/typecheck/migrate/seed/test。
  - `cert-init` / `db-init` / `portal` / `gateway` 服务用于 Gateway 闭环发布验收。
  - 两者共享同一份 PostgreSQL/Redis、同一套镜像构建上下文和同一份 Compose 项目名。

## 原则

Compose 文件应该按“职责边界”分，而不是按“今天哪个 workflow 恰好调用它”分。  
如果 CI 和 release 都是在做测试与构建发布拓扑，就应该共享同一份编排真相源，只通过启动的服务集合不同来表达差异，而不是继续复制成两份文件。

## 验证

- `.github/workflows/main.yml`、`.github/workflows/pr.yml`、`.github/workflows/release-validation.yml` 已全部切换到 `docker-compose.test.yml`。
- 三个触发 workflow 现在进一步通过 `.github/workflows/validation-suite.yml` 共享同一套 CI/release 验证职责，Compose 入口与 workflow 职责不再各自漂移。
- `scripts/run-gateway-e2e.sh` 已切换到 `docker-compose.test.yml`，并显式只启动 `postgres redis cert-init db-init portal gateway`。
- 本地开发脚本仍只依赖默认 `docker compose up -d postgres redis`，没有重新引入全栈 compose 入口。
- 仓库根目录已删除 `docker-compose.local.yml`、`docker-compose.ci.yml`、`docker-compose.e2e.yml`，当前只保留三份职责清晰的 compose 文件：
  - `docker-compose.yml`
  - `docker-compose.test.yml`
  - `docker-compose.prod.yml`
