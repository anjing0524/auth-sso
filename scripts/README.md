# scripts/ 脚本索引

> 本目录只放**可执行工具**，按职责分目录；每个脚本只做一件事。
> 根 `package.json` 的命令是**稳定入口**（`pnpm test:e2e`、`pnpm stack:*`），脚本路径属于实现细节。

## 目录与职责

| 目录 | 职责 | 脚本 |
|---|---|---|
| `docker/` | Docker 栈生命周期与生产部署 | `stack.sh`（构建/启动/状态/日志/停机/验收统一入口）、`deploy.sh`（生产部署：校验 → 构建 → migrate/seed → 启动 → 健康检查，可回滚） |
| `e2e/` | 发布验收（全部打 Docker 栈） | `release.sh`（`pnpm test:e2e`：起栈 → Playwright `tests/e2e` → 清理）、`acme-e2e.sh`（Pebble 本地 ACME 闭环）、`acme-staging.sh`（公网 Let's Encrypt staging 联调） |
| `ci/` | CI 状态校验与发布 | `verify.sh`（校验某提交的 GitHub Actions 真全绿，`cancelled`/失败一律非零退出）、`push-main.sh`（推送 main，网络失败重试、永久拒绝立即失败） |
| `bench/` | 性能基准（不参与门禁） | `gateway.mjs`（`/healthz`、静态资源、`/login` 的 RPS/延迟） |

## 归属规则

- **Docker/部署编排** → `docker/`；**验收用例编排** → `e2e/`；**CI/推送** → `ci/`；**测量** → `bench/`。
- shell 脚本内部一律先解析仓库根（`ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"`），再使用相对仓库根的路径；不依赖调用者的 cwd。
- 退出码即结论：失败必须非零退出，不用 `echo`/`git status` 覆盖 `$?`（见 `CODING_STANDARDS.md` 的「假绿」）。
- 新增脚本：放进对应职责目录并更新本表；若是常规开发入口，再在根 `package.json` 加一个 `pnpm` 命令。

## 与 Docker 配置的关系

`docker/` 目录放**声明式配置**（compose / Dockerfile / ACME fixtures / `README.md`），本目录的 `docker/` 放**命令式编排**；
两者的唯一入口约定见 [`docker/README.md`](../docker/README.md) §7。
