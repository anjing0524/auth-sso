<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

## 永远保持中文对话 所有对话提问都需要中文

use architecting-portal skill
use spec-docs skill
`@docs/spec/*` 文档提供理论支持
当前 Rust 版本环境约定（Rust 1.93.0+）：对于需要多线程并发调度（Send 约束）的 Trait 异步方法，必须采用“零开销异步 Trait”最佳实践：在 Trait 定义中使用 `-> impl std::future::Future<Output = T> + Send` 进行严格的线程安全约束，并在 `impl` 实现块中直接使用 `async fn` 语法以保持代码简洁。坚决避免引入 `#[async_trait]` 带来的 Box 堆分配开销。

## 基础环境

nodejs@26
nextjs@16
Rust 1.93.0+

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

- Vitest 4.x 使用 `test.projects` 聚合（根 vitest.config.ts → apps/portal/vitest.config.ts），非 `vitest.workspace.ts`
- jsdom 默认环境；API 测试文件用 `// @vitest-environment node` 行级覆盖
- Vite 8 原生支持 tsconfig paths 解析（无需 `vite-tsconfig-paths` 插件）
- API 测试 mock DB（`vi.mock()`）和 Redis；领域层纯函数 TDD 零 mock
- E2E Playwright 仅 Chromium，baseURL `http://localhost:4100`
- 需求追溯: 测试文件用 `@req` 注解标记覆盖的需求 ID
- 共享配置: `vitest.base.ts` (coverage/timeout) + `drizzle.base.ts`

## Portal 架构要点

详见 `docs/portal-architecture-guidelines.md`，以下为关键约束：

- **分层**: `src/app/[bc]/`（page.tsx + data.ts + actions.ts） → `src/domain/`（纯函数） → Drizzle 直调。无 Repository/Mapper 层
- **单控制器原则**: 内部页面写操作只用 Server Actions（actions.ts），不用 REST API 路由。外部系统/跨域/OIDC 回调才写 route.ts
- **读模型**: `data.ts` 中用 `"use cache"` + `cacheLife()` + `cacheTag()`（Next.js 16 Cache Components）
- **Controller 函数 ≤20 行**，不包含业务逻辑判断；`@/` 路径别名 = `src/`
- **domain 层纯 TS**: 禁止 import `next/*` 或 Drizzle；多表写入必须 `db.transaction()`
- **枚举值**: 从 `@auth-sso/contracts` 常值数组派生 `z.enum(ARR)` / `pgEnum(...)`，禁止手写字面量
- **错误处理**: `DomainError` 类体系 + `mapDomainError()` 统一映射，Controller 不手写 `instanceof` 分支
- **API 响应**: `ApiSuccess<T>` / `ApiError`（定义在 contracts）
- **三层安全**: Gateway（JWT 离线验签）→ Proxy（CSRF，Next.js 16 中 `proxy.ts` 替代 middleware）→ `withAuth`（精细鉴权，查 DB 实时权限）
- Portal 自身即 OIDC Provider，ES256 JWT 通过 `jose` 签发，密钥对存 PostgreSQL `jwks` 表

## Gateway (Rust) 要点

- edition = "2024"（注意 `use` 路径变更）
- Pingora 0.8.1 + OpenSSL（vendored）
- 需要 `Send` 约束的 Trait 异步方法: `-> impl Future<Output = T> + Send`，禁止 `#[async_trait]`
- 修改后必须 `cargo clippy --all-targets --all-features -- -D warnings` + `cargo fmt --all -- --check`
- 遵循 [Rust API 指南](https://rust-lang.github.io/api-guidelines/checklist.html)

## 其他约束

- pnpm@10.12.4，CI 使用 `--frozen-lockfile`
- ESLint flat config (`eslint.base.mjs`)，`consistent-type-imports` 使用 `inline-type-imports` 风格
- Next.js 16: Middleware 改名为 Proxy，Server Function 公开可达（三层防御原因）
- Docker Compose 本地开发: `docker compose up -d`（PostgreSQL 16 + Redis 7）
- 数据库初始化顺序: `pnpm db:push` → `pnpm db:seed`
