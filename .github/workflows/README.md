# GitHub Actions 索引

> 两类文件，职责禁止互相渗透：
> - **触发文件**：只声明 `on:` / `concurrency:` / 调用哪些类别 / 传哪些产物参数，**不含 `steps:`**；
> - **类别文件**（`workflow_call`）：一个文件一类验证，只调用仓库已有命令（`pnpm …` / `scripts/…`）；
>   跨多步编排放 `scripts/ci/`（见「修改规则」第 3 条）。
>
> 命令细节不在此重复：Docker / 验收命令见 [`docker/README.md`](../../docker/README.md) §7.2，
> 其余命令就是根 `package.json` 与 `apps/gateway` 的既有脚本；Docker 侧对应关系见其 §7.7。

## 文件分类

| 文件 | 类型 | 触发 | 作用 |
|---|---|---|---|
| `pr.yml` | 触发 | `pull_request` → `main` | 快层 + 验收层（ACME 只跑预检） |
| `main.yml` | 触发 | `push` → `main` | 同上（产物前缀 `main-`） |
| `nightly.yml` | 触发 | 每日 02:00（北京时间）/ 手动 | 全部 + ACME 全生命周期 |
| `release-validation.yml` | 触发 | tag `v*` / 手动 | 全部 + ACME 全生命周期（证据保留 30 天） |
| `quality.yml` | 类别 | `workflow_call` | Node 质量门禁 + Gateway Rust 质量门禁 |
| `acceptance.yml` | 类别 | `workflow_call` | Docker 发布栈 + `tests/e2e` 全部 spec |
| `acme.yml` | 类别 | `workflow_call` | ACME staging 预检（`lifecycle: false`）+ Pebble 生命周期（`lifecycle: true`） |

## 分层与命令

| 层 | 类别 / 作业 | CI 调用的命令 | 本地等价 |
|---|---|---|---|
| 快层（每次 push/PR，阻断） | `quality.yml` / `node` | `pnpm lint` · `pnpm typecheck` · `pnpm --filter @auth-sso/portal db:migrate` · `pnpm --filter @auth-sso/portal db:seed` · `pnpm test` · `node tests/traceability/generate-report.mjs`（均在 `node-test` 容器内） | 同左（先 `docker compose -f docker/compose/local.yml up -d`） |
| 快层 | `quality.yml` / `rust` | `cargo fmt --check` · `cargo clippy` · `cargo test` · `cargo build --release` · `cargo audit` | 同左（工作目录 `apps/gateway`） |
| 快层 | `acme.yml` / `preflight` | `scripts/ci/acme-preflight.sh` | CI 专用（断言 `acme-staging.sh` 的预检契约，无容器） |
| 验收层（每次 push/PR，阻断） | `acceptance.yml` / `docker-release` | `scripts/ci/e2e.sh` | `pnpm test:e2e`（`scripts/e2e/release.sh`） |
| 高成本层（release/夜间） | `acme.yml` / `lifecycle` | `scripts/e2e/acme-e2e.sh` | `./scripts/e2e/acme-e2e.sh` |

> 两层依赖审计（`pnpm audit` / `cargo audit`）**不阻断**：结论看本步日志（取证经过与触发条件写在 `quality.yml` 注释里）。
> `cargo audit` 需要先装工具（runner 不带），由 `taiki-e/install-action` 安装；`pnpm audit` 必须打官方 registry。
> 覆盖率不是门禁：本仓 CI 从未跑 `--coverage`（见 `CODING_STANDARDS.md` 第 7 条）。

## 修改规则

1. 新增验证：先判断属于哪一类 → 加进对应**类别文件**；不属于任何一类就先别加。
2. 触发文件不得出现 `steps:` / `run:`；类别文件不得出现 `on: push | pull_request | schedule | workflow_dispatch`。
3. 跨多步编排（起栈、跑浏览器测试、证据断言）放 `scripts/ci/*.sh`，YAML 里调用一行——失败时脚本可本地复跑；
   单步命令与短小的仓库内不变量检查留在 YAML（读起来直接、失败定位清楚）。
4. 改触发时机 / 产物参数只动触发文件；改验证内容只动类别文件。
