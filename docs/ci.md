# GitHub Actions 索引

> 两类文件，职责禁止互相渗透：
> - **触发文件**：只声明 `on:` / `concurrency:` / 调用哪些类别 / 传哪些产物参数，**不含 `steps:`**；
> - **类别文件**（`workflow_call`）：一个文件一类验证，只调用仓库已有命令（`pnpm …` / `scripts/…`）；
>   跨多步编排放 `scripts/ci/`（见「修改规则」第 3 条）。
>
> 命令细节不在此重复：Docker / 验收命令见 [`docs/docker.md`](docker.md) §7.2，
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
| 快层（每次 push/PR，阻断） | `quality.yml` / `node` | `pnpm lint` · `pnpm typecheck` · `pnpm --filter @auth-sso/portal db:migrate` · `pnpm --filter @auth-sso/portal db:seed` · `pnpm test:coverage`（逻辑回归 + auth/permission/oauth 覆盖率阈值）· `pnpm test:mutation`（auth 领域 mutation，break 65）· `node tests/traceability/generate-report.mjs`（均在 `node-test` 容器内） | 同左（先 `docker compose -f docker/compose/local.yml up -d`） |
| 快层 | `quality.yml` / `rust` | `cargo fmt --check` · `cargo clippy` · `cargo test` · `cargo build --release` · `cargo audit` | 同左（工作目录 `apps/gateway`） |
| 快层 | `acme.yml` / `preflight` | `scripts/ci/acme-preflight.sh` | CI 专用（断言 `acme-staging.sh` 的预检契约，无容器） |
| 验收层（每次 push/PR，阻断） | `acceptance.yml` / `docker-release` | `scripts/ci/e2e.sh`（关键路径 E2E + 桌面视觉基线 + a11y） | `pnpm test:e2e`；独立门禁 `pnpm test:visual` / `E2E_CHANNEL=chrome pnpm test:a11y` |
| 高成本层（release/夜间） | `acme.yml` / `lifecycle` | `scripts/e2e/acme-e2e.sh` | `./scripts/e2e/acme-e2e.sh` |

> 两层依赖审计（`pnpm audit` / `cargo audit`）**不阻断**：结论看本步日志（取证经过与触发条件写在 `quality.yml` 注释里）。
> `cargo audit` 需要先装工具（runner 不带），由 `taiki-e/install-action` 安装；`pnpm audit` 必须打官方 registry。
> **覆盖率是门禁**：`pnpm test:coverage` 生成 `coverage/coverage-summary.json`，再由
> `scripts/ci/coverage-gate.mjs` 校验 auth / permission / oauth 与总行/分支覆盖阈值；基线见脚本头注释。
>
> **验证分层（不要混为一谈）**：
> - `pnpm test`：全部逻辑/API/组件回归；`pnpm test:api` / `test:ui` / `test:contracts` 可按层单独运行。
> - `pnpm test:coverage`：逻辑回归 + 核心安全域覆盖率阈值。
> - `pnpm test:mutation`：auth 领域 mutation（Stryker），当前基线 94.50%，break 92；全量 hookTimeout 30s；不是覆盖率替代品。
- `pnpm test:e2e`：真实 Docker 栈的关键用户路径；默认不跑视觉基线。
> - `pnpm test:visual`：桌面 1440/1280 截图基线（`E2E_VISUAL=1`），独立门禁。
> - `E2E_CHANNEL=chrome pnpm test:a11y`：对比度/键盘门禁，独立门禁。
> - `pnpm test:ai`：Midscene AI 视觉探索性测试（非阻断，手动运行；需要模型 Key）。
> - 客户环境验收：ACME、备份恢复、回滚、UAT；仓库测试不能替代。

## 修改规则

1. 新增验证：先判断属于哪一类 → 加进对应**类别文件**；不属于任何一类就先别加。
2. 触发文件不得出现 `steps:` / `run:`；类别文件不得出现 `on: push | pull_request | schedule | workflow_dispatch`。
3. 跨多步编排（起栈、跑浏览器测试、证据断言）放 `scripts/ci/*.sh`，YAML 里调用一行——失败时脚本可本地复跑；
   单步命令与短小的仓库内不变量检查留在 YAML（读起来直接、失败定位清楚）。
4. 改触发时机 / 产物参数只动触发文件；改验证内容只动类别文件。
