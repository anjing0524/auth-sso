# Next.js RSC 构建期数据库边界收敛

## 问题

Portal 审计读模型 `apps/portal/src/app/audit/data.ts` 在模块顶层静态 import `@/infrastructure/db`，而数据库基础设施在模块加载时立即通过 `getEnvConfig().DATABASE_URL` 解析环境变量并初始化连接。结果是即使审计 API Route Handler 本身是请求期动态执行，只要 `next build` 在分析 `/api/audit/export` 等路由时触碰到这条 import 链，就会在构建阶段提前求值并抛出 `DATABASE_URL` 缺失，最终表现为 `Failed to collect page data for /api/audit/export`。

同时，修复过程中暴露出一个常见误区：把 `connection()` 或 `dynamic = 'force-dynamic'` 当成通用止血手段。对这个项目启用的 Next.js 16 Cache Components 而言，Route Handler 里声明 `dynamic` 直接与配置冲突；而对默认已动态的 `GET` Route Handler，再额外堆 `connection()` 也不能解决“模块顶层已触发 env/db 求值”这一更早发生的问题。

## 决策

- 审计读模型不再在模块顶层 import `db` / `schema`，改为在函数内部通过 `await import('@/infrastructure/db')` 惰性装载，请求到来时才解析 `DATABASE_URL` 并建立数据库访问路径。
- 审计 API Route Handler 保持 Next.js 默认动态行为，不导出 `dynamic`，也不再用 `connection()` 作为伪动态边界。
- `withPermission` 从鉴权包装层移除统一的 `connection()` 调用，避免把“需要真实请求上下文”和“只是错误地在模块顶层触库”两类问题混为一谈。

## 原则

Next.js 16 / RSC / Route Handler 的边界要分清：

- `Page` / RSC 是否在构建期执行，取决于该段是否进入静态或部分预渲染路径；需要等待真实请求时，优先用框架认可的动态边界。
- `GET` Route Handler 默认就是按请求动态执行；真正需要避免的是“构建分析阶段触发模块顶层副作用”。
- 任何依赖 `DATABASE_URL`、Redis、外部服务或进程环境的初始化，都不得放在会被 route/page 顶层 import 立即执行的链路上；应延迟到明确的请求期或运行期函数内部。

## 验证

- `apps/portal/__tests__/api/permission-enforcement.test.ts` 全量通过：22/22。
- `docker compose -f docker-compose.test.yml build portal` 在 Tuesday, July 28, 2026 本地复验通过。
- 构建产物路由表中 `/api/audit/access-logs`、`/api/audit/export`、`/api/audit/login-logs`、`/api/audit/logs` 均为 `ƒ`，说明它们保持请求期动态执行。
- 构建阶段不再出现 `Failed to collect page data for /api/audit/export` 或 `DATABASE_URL expected string, received undefined`。
