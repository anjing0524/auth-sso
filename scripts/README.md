# scripts/ 脚本索引

> 本目录只放**可执行工具**，按职责分目录；每个脚本只做一件事（下表与目录一一对应，不写死篇数）。
> 根 `package.json` 的命令是**稳定入口**（`pnpm test:e2e`、`pnpm test:e2e:acme[:staging]`、`pnpm stack:*`），脚本路径属于实现细节。
> 落单的例外：`clean` 只有脚本入口（`scripts/docker/stack.sh clean`），没有 pnpm 别名。

## 目录与职责

| 目录 | 职责 | 脚本 |
|---|---|---|
| `docker/` | Docker 栈生命周期与生产部署 | `stack.sh`（验收栈生命周期统一入口：`up\|build\|status\|logs\|e2e\|down\|clean`）、`deploy.sh`（生产部署：校验 → 构建 → migrate/seed → 启动 → 健康检查，支持 `--check\|--no-build\|--status\|--rollback\|--down`） |
| `e2e/` | 发布验收（全部打 Docker 栈） | `release.sh`（`pnpm test:e2e`：`stack.sh e2e --build` → 跑 `tests/e2e` 全部 spec → 退出清理；`SKIP_BUILD=1` / `E2E_KEEP_STACK=1`）、`acme-e2e.sh`（Pebble 本地 ACME 闭环）、`acme-staging.sh`（公网 Let's Encrypt staging 联调） |
| `ci/` | CI 专用编排（状态校验、推送、CI 步骤实现） | `verify.sh`（校验某提交的 GitHub Actions 真全绿，`cancelled`/失败一律非零退出）、`push-main.sh`（推送 main，网络失败重试、永久拒绝立即失败）、`acme-preflight.sh`（`acme.yml` 的预检作业：断言 `e2e/acme-staging.sh` 的预检契约）、`e2e.sh`（`acceptance.yml` 的验收作业：复用 `docker/stack.sh` 起栈 + Playwright 容器内跑 `tests/e2e`） |
| `bench/` | 性能基准（不参与门禁） | `gateway.mjs`（`/healthz`、`/login`、`/_next/static/*.js` 的 RPS/延迟；有失败请求则退出码非 0） |

> 命令细节不在此重复：日常/验收命令见 [`docker/README.md`](../docker/README.md) §7.2，生产部署见其 §4。

## 归属规则

- **Docker/部署编排** → `docker/`；**验收用例编排** → `e2e/`；**CI 专用编排** → `ci/`；**测量** → `bench/`。
  判断依据：会被本地日常入口（`pnpm …`）复用的放前两类；只被 `.github/workflows/` 步骤调用的放 `ci/`。
- shell 脚本内部一律先解析仓库根，再使用相对仓库根的路径；不依赖调用者的 cwd。现有脚本全部满足，写法有两种等价形式：
  `ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"`（`stack.sh` / `release.sh` / `acme-e2e.sh` / `acme-staging.sh` / `verify.sh` / `push-main.sh` / `acme-preflight.sh` / `e2e.sh`）、
  `deploy.sh` 先取 `SCRIPT_DIR` 再 `ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"` 并 `cd` 过去（因此可以按 `.env.prod` 这类仓库根相对路径工作）。
  `bench/gateway.mjs` 是纯网络压测，不读写仓库内文件，无 cwd 依赖。
- 退出码即结论：失败必须非零退出，不用 `echo`/`git status` 覆盖 `$?`（见 `CODING_STANDARDS.md` 的「假绿」）。
  `verify.sh` / `push-main.sh` 都显式 `set -uo pipefail` 而不在末尾追加总结性命令（那会覆盖 `$?`）。
- 新增脚本：放进对应职责目录并更新本表；若是常规开发入口，再在根 `package.json` 加一个 `pnpm` 命令。
- CI 步骤只调用**一行**命令：跨多步编排（起栈、跑浏览器测试、证据断言）放 `ci/*.sh`，
  约定见 [`.github/workflows/README.md`](../.github/workflows/README.md)「修改规则」。

## 与 Docker 配置的关系

`docker/` 目录放**声明式配置**（compose / Dockerfile / ACME fixtures / `README.md`），本目录的 `docker/` 放**命令式编排**；
两者的唯一入口约定见 [`docker/README.md`](../docker/README.md) §7（§7.1 运行入口、§7.2 常用命令）。
