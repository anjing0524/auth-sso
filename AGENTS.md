<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

## 永远保持中文对话 所有对话提问都需要中文

`@docs/spec/*` 文档提供理论支持
决策索引：动手改某块之前若想知道「这件事以前有人做过吗 / 为什么长这样」，先读 `docs/solution/README.md`（按主题索引历次决策与教训）
Rust 异步 Trait 的写法见「Gateway (Rust) 要点」（唯一出处，勿在此重复）。

## 基础环境

nodejs@26（nvm default；Temporal 需要 `--harmony-temporal`——已在 vitest.base.ts / portal dev/start / Vercel CMD 内置，**勿删**）
  ⚠️ **但「内置」≠「能起」（2026-10-16 实测）**：`apps/portal` 的 `dev`/`start` 把该旗标放进 `NODE_OPTIONS`，
  而 node@26 **拒绝** `NODE_OPTIONS` 里的 V8 旗标（`node: --harmony-temporal is not allowed in NODE_OPTIONS`，
  进程启动瞬间退出、端口无响应）⇒ `pnpm --filter @auth-sso/portal dev/start` **当前起不来**。
  已试过把它移到 node 命令行注入，**仍见到同一报错** ⇒ 另有传播机制，**未查明**（不猜）。
  需要本地起 Portal 时：单开一轮专查此事，或请用户在有相应 Node 环境时验证。
nextjs@16
Rust 1.93.0+
git 身份/远程：GitHub 推送一律用 `gh` CLI（HTTPS + 凭据助手已配置，账号 anjing0524）；本机 `id_ed25519` 是 `anjing0524/vue-refresh` 仓库的 deploy key，对 auth-sso 无推送权限，勿走 SSH；Docker 命令当前用户已入 docker 组（旧会话内用 `sg docker -c` 或 sudo 兜底）

## 优先

优先深度思考，
优选考虑适合的数据结构和内存管理
优先WebSearch获取最新相关文档

## 必须

架构必须足够清晰，架构污染零容忍
修复问题必须总结-审阅-修订同类问题，沉淀到docs/solution，记录为最佳实践
修改文档前必须重新阅读，文档可能被多人更新
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
- E2E Playwright 仅 Chromium，默认 baseURL `http://127.0.0.1:4102`（可用 `E2E_BASE_URL` 覆盖）
- 需求追溯: 测试文件用 `@req` 注解标记覆盖的需求 ID
- 共享配置: `vitest.base.ts`（仅 testTimeout，coverage 在根 `vitest.config.ts`）+ `drizzle.base.ts`

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
- Docker Compose 本地开发: `docker compose up -d`（PostgreSQL 16 + Redis 7）
- 数据库初始化顺序: `pnpm db:migrate` → `pnpm db:seed`；`db:push` 只允许本地临时试验，不进入 CI/发布路径
- **e2e 在本机跑不起来（环境约束，不要再试）**：`pnpm test:e2e` → `scripts/run-gateway-e2e.sh` 会 `docker compose --build`
  起全栈，而镜像构建里有 `RUN npm install -g pnpm@10.12.4` ⇒ 本沙箱**访问不了 registry.npmjs.org**
  （`npm error code ETIMEDOUT`，与 `ERR_PNPM_EROFS` 同族）。实测两次：①先撞 buildx 状态目录只读
  （`~/.docker/buildx` ⇒ `read-only file system`，可用 `BUILDX_CONFIG=$PWD/.tmp-buildx` 绕开）
  ②绕开后仍卡在 npm registry ⇒ **到此为止，不要反复尝试**。需要 e2e 时请在有网环境跑，或让用户代跑。
  附带结论（有用）：该脚本建/清的是**自己的** `auth-sso-test` 栈（compose 文件顶层 `name:`），
  与开发栈 `auth-sso-*` 完全隔离 —— 本地跑不会动到 `pnpm test` 依赖的测试库。
- **装新依赖**：`pnpm add` 若报 `ERR_PNPM_EROFS`（pnpm store 只读）⇒ 报告并请用户代跑，保持包管理器、锁文件与 CI 的 `--frozen-lockfile` 原样（实测：`eslint-plugin-sonarjs` 因此装不上，#89 只给结论不落地）
- **长作业先固化 SHA，再单独启动**：`scripts/ci-verify.sh <sha>` 在提交**之后**单独跑；脚本一旦启动就当它只读（要改就停下重跑）。本会话两种竞态各踩一次：`git rev-parse` 落在旧提交上、bash 增量读到半行。
- **门禁结论取退出码**（加末尾的 `✖ N problems (X errors…)` 汇总行）；grep 只用来筛行、不当结论：`grep '^\s*[0-9]+:[0-9]+\s+error'` 曾把 1 个 lint error 读成「0 error」（真实输出带 `apps/portal lint:` 前缀）；同理**别把校验脚本塞进管道**——`| tail` 会让退出码变成 `tail` 的（实测：一个被取代成 `cancelled` 的 run 因此被读成 exit 0；`scripts/ci-verify.sh` 有运行级判据，直接跑、看它的退出码）。**一次推送只验一个**：同一分支的新推送会取消旧 run（本会话三个连续提交的 run 都被取代成 `cancelled`，于是"绿"永远拿不到）⇒ 上一轮绿了再推下一轮。
- **批量改写脚本用三引号或中文引号，写完先看确认行**：英文引号嵌进双引号 Python 字符串会让整段脚本**不执行**（本会话反复栽在它上面；最严重的一次导致索引与 roadmap 漏写）。
- **先把失败的值带出来，再改代码**：断言写 `expect(actual, JSON.stringify(actual)).toBe(…)`；读不到可读原因时先建探针（`JSON.stringify`、被包装的 `err.cause`、单独 `await` 那一步），用完撤掉。本会话一处悬案靠猜白花了好几次尝试，探针一上就定位到 `err.cause` 里的 `departments_pkey` 重复。
- **文档维护**：新增 solution 文档必须挂进 `docs/solution/README.md` 的主题下（`docs-references.test.ts` 断言无遗漏）；引用既有决定前先查它。
