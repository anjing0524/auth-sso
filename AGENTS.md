<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

## 永远保持中文对话 所有对话提问都需要中文

`@docs/spec/*` 文档提供理论支持
决策记录：想知道「这件事以前有人做过吗 / 为什么长这样」先查 `docs/adr/`；里程碑与取舍见 `docs/roadmap.md`。
Rust 异步 Trait 的写法见「Gateway (Rust) 要点」（唯一出处，勿在此重复）。

## 基础环境

nodejs@26（nvm default；**Temporal 在 v26.10.0 已默认开启，不需要任何旗标**——历史上的 `--harmony-temporal` 已于 2026-10-19 全部移除，原因见下）
  ✅ **该旗标已移除（2026-10-19 修复）**：`apps/portal` 的 `dev`/`start` 原本把 `--harmony-temporal`
  放进 `NODE_OPTIONS`，而 node@26 **拒绝** `NODE_OPTIONS` 里的 V8 旗标 ⇒ `pnpm dev` 起不来。
  根因不止于此：**Next.js 会把父进程 `execArgv` 重新序列化进子进程的 `NODE_OPTIONS`**
  （`next/dist/lib/worker.js:84`），所以"把旗标移到命令行"同样无效。实证：**Node v26.10.0
  已默认开启 Temporal**（带/不带旗标 `typeof Temporal === 'object'`），旗标已无必要 ⇒
  全部移除（含 `vitest.base.ts` 的 `forks.execArgv`、两个 Dockerfile 的 CMD 命令行旗标——
  镜像里 Node 26 同样默认开启 Temporal，2026-10-20 清理时一并删掉）。
  回归守卫：`apps/portal/__tests__/api/node-options-guard.test.ts`（对每个 `NODE_OPTIONS`
  取值真跑一次 `node -e ""`，被拒即红）；冒烟 = Docker 验收栈上 `https://127.0.0.1:19443/login`
  拿到**真实 HTTP 200**（`pnpm stack:up` + `curl -k`），**只看日志 Ready 会假绿**。
nextjs@16
Rust 1.93.0+
git 身份/远程：GitHub 推送走 **SSH**（`origin = git@github.com:anjing0524/auth-sso.git`；已实测 `ssh -T git@github.com` 鉴权为账号 anjing0524，`git push origin main` 即可）。**不要**改用 HTTPS / `gh` 凭据助手——此前"勿走 SSH、改用 gh HTTPS"的指引是错的（2026-10-23 用户纠正）。Docker 命令当前用户已入 docker 组（旧会话内用 `sg docker -c` 或 sudo 兜底）

## 优先

优先深度思考，
优选考虑适合的数据结构和内存管理
优先WebSearch获取最新相关文档

## 必须

架构必须足够清晰，架构污染零容忍
修复问题必须总结-审阅-修订同类问题，沉淀到 `docs/adr/` 或 `docs/roadmap.md`，记录为最佳实践
修改文档前必须重新阅读，文档可能被多人更新
文档引用代码用**仓库相对路径 + 章节号/符号名**，不写 `:行号`（行号必漂移；只写不存在的文件 = 死引用）
rust 代码修改后必须修复 `cargo clippy`的所有错误并执行 `cargo fmt` 格式化
rust 代码必须遵循 `https://rust-lang.github.io/api-guidelines/checklist.html`
使用`roadmap`记录系统完成情况
阅读文档务必一次性全读取，文档提到的代码也一次性全读取

## 禁止

禁止反复修改同一行代码、微调参数
禁止只考虑兼容方案而不思考全局最佳理论方案
禁止代码没有读取完整的时候直接向LLM提问

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 项目结构

```
apps/gateway/      信创网关 (Rust/Pingora) — HTTPS 终结 + ES256 JWKS 离线验签
apps/portal/       管理门户 + OIDC Provider (Next.js 16) — 端口 4100
apps/demo-app/     Demo 应用
packages/contracts/ 共享类型、错误码、权限码、OIDC 常量（枚举值唯一真相源）
packages/config/    共享 env 配置 (Zod + URL 推导)
```

## 测试体系 (Vitest 4 Projects 模式)

- Vitest 4.x 使用 `test.projects` 聚合（根 `vitest.config.ts` → `apps/portal/vitest.api.config.ts` + `apps/portal/vitest.ui.config.ts` + `packages/contracts/vitest.config.ts`），非 `vitest.workspace.ts`
- 测试环境按 project 划分：API project 全局 `node`（`vitest.api.config.ts`），UI/domain project 全局 `jsdom`（`vitest.ui.config.ts`）；UI project 下个别需 node 的文件用 `// @vitest-environment node` 行级覆盖
- Vite 8 原生支持 tsconfig paths 解析（无需 `vite-tsconfig-paths` 插件）
- API project 以 Docker Compose 暴露的 PostgreSQL/Redis 作为真实基础设施基线；UI/domain project 不依赖数据库
- E2E Playwright 仅 Chromium，**只跑 Docker 验收栈**：默认 baseURL `https://127.0.0.1:19443`（可用 `E2E_BASE_URL` 覆盖），无 host `next dev` webServer
- 需求追溯: 测试文件用 `@req` 注解标记覆盖的需求 ID
- 共享配置: `vitest.base.ts`（仅 testTimeout，coverage 在根 `vitest.config.ts`）+ `drizzle.base.ts`

| 层 | 位置 | 环境 / 框架 | 范围 | 命令 |
|---|---|---|---|---|
| 单元 / 组件 | `apps/*/__tests__/{components,domain,helpers}` | jsdom + Vitest | 渲染、交互、纯函数；外部 UI 原语与数据源可 mock | `pnpm test:components` |
| API | `apps/*/__tests__/api/*.test.ts` | node + **真实 PostgreSQL / Redis** | route 与 action 的校验、鉴权、CRUD、数据范围过滤 | `pnpm test:api` |
| E2E | `tests/e2e/*.spec.ts` | Playwright（仅 Chromium） | 登录冒烟与 Docker 发布栈闭环 | `pnpm test:e2e` |

API 层里生产业务模块的模块级 mock 必须是**类型化工厂**（`vi.mock(import('…'), (): Partial<typeof xModule> => …)`）
并带 `// @allow-module-mock <target> <kind>: <理由>`；签发/验签/撤销/登录/权限/审计等安全语义**真实驱动**。
规则出处 `docs/adr/ADR-022-test-authenticity-strategy.md`，由 `apps/portal/__tests__/api/module-mock-guard.test.ts` 在 `pnpm test` 内强制。
**不维护"关键测试文件清单"**：目录就是清单（清单会过期）。

## 追溯（`@req`）

`tests/traceability/generate-report.mjs` 扫测试文件里的 `@req` 注解（文件级 JSDoc 与行级注释都算），
与 `docs/spec/REQUIREMENTS_MATRIX.md` 对齐，生成 `tests/traceability/.generated/coverage-report.md`（本地生成，不提交）。
写法：单 ID · 逗号并列 · 区间 `AUTH-001~005` · 斜杠 `F-DEP-L/C/U/D` · 混写。
**报告是需求映射清单，不是门禁**；阻断门禁是 Vitest / lint / typecheck / Docker 发布验收。

## 文档与流程

- 议题在 GitHub Issues（`anjing0524/auth-sso`，走 `gh` CLI）；五个 triage 标签保持默认。
- 领域词汇唯一真相源：`docs/glossary.md`；架构决策：`docs/adr/`（ADR-001~026）。

## Portal 架构要点

详见 `docs/portal-architecture-guidelines.md`，以下为关键约束：

- **分层**: `src/app/(dashboard)/` 等页面目录（page.tsx + data.ts + actions.ts） → `src/domain/`（纯函数） → Drizzle 直调。无 Repository/Mapper 层
- **单控制器原则**: 内部页面写操作只用 Server Actions（actions.ts），不用 REST API 路由。外部系统/跨域/OIDC 回调才写 route.ts
- **读模型**: `data.ts` 中用 `"use cache"` + `cacheLife()` + `cacheTag()`（Next.js 16 Cache Components）
- **Controller 职责约束**（唯一硬性）：不得出现业务规则判定（`instanceof` 错误分支 / 权限判定 / 状态机 / 配额计算），只允许「编排 + 映射」两类语句；必须经 `withAuth` + `validate()` + `withScopedWrite/withScopedRow`，多表写入同一事务。**不设行数上限**——行数不是复杂度的好代理（见 ADR-019）。复杂度由 lint 强制：`complexity ≤ 15`、`max-depth ≤ 4`；`@/` 路径别名 = `src/`
- **domain 层纯 TS**: 禁止 import `next/*` 或 Drizzle；多表写入必须 `db.transaction()`
- **枚举值**: 从 `@auth-sso/contracts` 常值数组派生 `z.enum(ARR)` / `pgEnum(...)`，禁止手写字面量
- **错误处理**: `DomainError` 类体系 + `mapDomainError()` 统一映射，Controller 不手写 `instanceof` 分支
- **API 响应**: `ApiSuccess<T>` / `ApiError`（定义在 contracts）
- **三层安全**: Gateway（JWT 离线验签）→ Proxy（CSRF，Next.js 16 中 `proxy.ts` 替代 middleware）→ `withAuth`（精细鉴权，查 DB 实时权限）
- Portal 自身即 OIDC Provider，ES256 JWT 通过 `jose` 签发，密钥对存 PostgreSQL `jwks` 表

## Gateway (Rust) 要点

- edition = "2024"（注意 `use` 路径变更）
- Pingora 0.9.0 + OpenSSL（vendored）
- 自定义 Trait 的 `Send` 约束异步方法: `-> impl Future<Output = T> + Send`；`#[async_trait]` 仅用于 Pingora 框架 trait 回调（签名由框架固定，无法避免）
- 修改后必须 `cargo clippy --all-targets --all-features -- -D warnings` + `cargo fmt --all -- --check`
- 遵循 [Rust API 指南](https://rust-lang.github.io/api-guidelines/checklist.html)

## 其他约束

- pnpm@10.12.4，CI 使用 `--frozen-lockfile`
- ESLint flat config (`eslint.base.mjs`)，`consistent-type-imports` 使用 `inline-type-imports` 风格
- Next.js 16: Middleware 改名为 Proxy，Server Function 公开可达（三层防御原因）
- **Docker 是构建 / 部署 / 验收的主路径**（CI 亦然，见 `validation-suite.yml`）。唯一入口与文件矩阵：**`docker/README.md` §7**（生产部署在 §1–§6）。
  常用：`pnpm stack:up|build|status|logs|down`（== `./scripts/docker/stack.sh`）、`pnpm test:e2e`
  （== `scripts/e2e/release.sh`：构建 → 起 `auth-sso-test` 栈 → Playwright release 闭环 → 清理）。
  入口 `https://127.0.0.1:19443`（自签证书，`curl -k` / Playwright `ignoreHTTPSErrors`）。
  2026-10-20 实测：`stack.sh build` 成功（portal 的 `next build` 走 Next 16 默认 **Turbopack**，
  `✓ Compiled successfully in 10.5s`；gateway `cargo build --release`）、`stack.sh up` 全健康、
  `pnpm test:e2e` **1/1 通过**。**旧结论"本机 e2e / 镜像构建不可用"已作废**——真实原因只是 buildx
  配置目录只读（`BUILDX_CONFIG=$PWD/.tmp-buildx`，`stack.sh` 已自动处理），不是 registry 不可达。
- 本地基础设施（仅跑 `pnpm test` 时需要；验收栈自带 PG/Redis）: `docker compose -f docker/compose/local.yml up -d`（PostgreSQL 16 + Redis 7）。
- 数据库初始化顺序: `pnpm db:migrate` → `pnpm db:seed`；`db:push` 只允许本地临时试验，不进入 CI/发布路径。
- **host 进程入口已移除**（2026-10-20 清理）：不再有 `pnpm dev` / `dev:*` / `check-portal-boot.sh` /
  `dev-gateway-stack.sh` / `verify-turbopack-container.sh`。原因：验收必须打到构建产物，且宿主 glibc
  2.28 跑不了 Turbopack；容器内 glibc 2.36 无此问题，镜像里的 `next build`（默认 Turbopack）就是
  Turbopack 的可用性证明。**唯一判据**：`pnpm stack:up` 后 `https://127.0.0.1:19443/login` 真实 200 +
  `pnpm test:e2e` 闭环通过。`NODE_OPTIONS` 里的 V8 旗标问题已修（2026-10-19，Temporal 在 node@26 默认开启）。
- **装新依赖**：`pnpm add` 若报 `ERR_PNPM_EROFS`（pnpm store 只读）⇒ 报告并请用户代跑，保持包管理器、锁文件与 CI 的 `--frozen-lockfile` 原样（实测：`eslint-plugin-sonarjs` 因此装不上，#89 只给结论不落地）
- **长作业先固化 SHA，再单独启动**：`scripts/ci/verify.sh <sha>` 在提交**之后**单独跑；脚本一旦启动就当它只读（要改就停下重跑）。本会话两种竞态各踩一次：`git rev-parse` 落在旧提交上、bash 增量读到半行。
- **门禁结论取退出码**（加末尾的 `✖ N problems (X errors…)` 汇总行）；grep 只用来筛行、不当结论：`grep '^\s*[0-9]+:[0-9]+\s+error'` 曾把 1 个 lint error 读成「0 error」（真实输出带 `apps/portal lint:` 前缀）；同理**别把校验脚本塞进管道**——`| tail` 会让退出码变成 `tail` 的（实测：一个被取代成 `cancelled` 的 run 因此被读成 exit 0；`scripts/ci/verify.sh` 有运行级判据，直接跑、看它的退出码）。**一次推送只验一个**：同一分支的新推送会取消旧 run（本会话三个连续提交的 run 都被取代成 `cancelled`，于是"绿"永远拿不到）⇒ 上一轮绿了再推下一轮。
- **批量改写脚本用三引号或中文引号，写完先看确认行**：英文引号嵌进双引号 Python 字符串会让整段脚本**不执行**（本会话反复栽在它上面；最严重的一次导致索引与 roadmap 漏写）。
- **先把失败的值带出来，再改代码**：断言写 `expect(actual, JSON.stringify(actual)).toBe(…)`；读不到可读原因时先建探针（`JSON.stringify`、被包装的 `err.cause`、单独 `await` 那一步），用完撤掉。本会话一处悬案靠猜白花了好几次尝试，探针一上就定位到 `err.cause` 里的 `departments_pkey` 重复。
- **文档维护**：改动文档后跑文档守卫（`apps/portal/__tests__/api/docs-*.test.ts`；`docs-claims.test.ts` 现在还守 `docs/README.md` / 根 `README.md` 里可重算的目录计数）；引用既有决定前先查 `docs/adr/`。
