# CI 与初始化入口收敛

## 问题

主 CI 已经切到空库 `db:migrate`，但发布验收栈、接入文档和操作约束仍残留 `db:push`。结果是仓库同时存在三套数据库初始化真相源：CI 走 migration、发布验收走 push、文档继续指导开发者走 push。另有 `apps/portal/tsc_output.txt` 这类一次性诊断产物被提交进仓库，持续制造失真故障噪声。Portal `tsconfig.json` 还把 `.next/dev/types` 这种开发期缓存产物纳入了正式类型检查，已删除路由会通过 Next 生成的 validator 幽灵引用重新污染 `typecheck`。

## 决策

- 将发布验收栈的初始化路径收敛为 `pnpm db:migrate && pnpm db:seed`，与 PR/Main CI 保持一致。
- 将 PR/Main CI 改为由 GitHub runner 调度仓库内 `docker-compose.test.yml`：`postgres`、`redis` 与 `node-test` 共享同一 Compose 网络，lint/typecheck/migrate/seed/test 全部在 `node-test` 容器内执行，不再让宿主机进程通过暴露端口旁路访问数据库。
- 将 PR/Main CI 的数据库初始化补齐并统一为 `db:migrate -> db:seed`，不再让同一套测试在“空 schema”和“带基础数据”两种前置条件间漂移。
- 明确 GitHub 的职责边界只到 CI 验证为止；`db:maintain-partitions` 虽然保留为运行时脚本，但不再由 GitHub Actions 定时连接外部数据库执行，避免把仓库 CI 平台误用为生产运维入口。
- 将 `release-validation.yml` 的 Playwright 验收也切换到 Docker 容器内执行，GitHub runner 只负责拉起不可变发布栈；浏览器测试本身运行在官方 Playwright 镜像中，不再保留“发布栈在 Docker、验收器在宿主机 Node”这一单独例外。
- 将 `pr.yml`、`main.yml` 与 `release-validation.yml` 的验证职责进一步收敛到可复用 workflow：release 不再只跑浏览器闭环，而是与 CI 共享完整的 lint/typecheck/migrate/seed/test、Gateway Rust 质量门禁与 Gateway 发布旅程，只通过输入参数区分 artifact 命名和主干专属的故障注入烟测。
- 将 `README.md`、`AGENTS.md`、`docs/INTEGRATION_GUIDE.md` 的默认初始化顺序统一改为 `db:migrate -> db:seed`，并明确 `db:push` 只允许本地临时试验。
- 删除根脚本里没有任何消费者、且只是 `docker compose up -d` 薄包装的 `infra:up` 别名，避免继续维护无语义增量的空入口。
- 删除 `apps/portal/package.json` 中只执行 `seed-rbac.ts` 的重复 `seed` 别名；真实初始化入口只保留 `db:seed`，避免出现“只灌 RBAC”与“全量初始化”两套并行语义。
- 删除没有任何 package/CI/文档消费者的 `apps/portal/scripts/cleanup-expired-tokens.ts` 及其 `db:cleanup` 命令，避免保留未纳入运维流程的孤儿脚本。
- 删除 `apps/portal/tsc_output.txt` 并加入 `.gitignore`，禁止一次性 TypeScript 诊断快照重新污染工作树。
- Portal `tsconfig.json` 仅保留 `.next/types/**/*.ts`，移除 `.next/dev/types/**/*.ts` 等开发态缓存输入，避免已删除路由或页面通过陈旧 validator 伪造 `typecheck` 失败。
- Playwright 本地 `webServer` 与 E2E global setup 移除对 `pnpm exec`/`pnpm db:seed` 的外壳依赖，改为直接调用项目内 `next` 二进制和 Node seed 脚本，减少包管理器切换链引入的假性失败。
- Portal Vitest 拆为 `@auth-sso/portal-api` 与 `@auth-sso/portal-ui` 两个 project：只有 API 项目执行 PostgreSQL/Redis global setup，组件/领域/辅助测试不再被数据库前置条件错误阻塞。
- 删除无运行时消费者、却继续污染规范与权限分组的 `LOGIN_LOG_PERMISSIONS` 常量族；登录日志与操作日志统一复用 `portal:audit:read` / `portal:audit:export`，避免契约层保留僵尸权限码。
- `apps/portal` 的 `db:migrate` 不再委托 `drizzle-kit migrate` 黑盒 CLI，而是改为仓库内 `scripts/migrate.ts` 直接执行 `drizzle/*.sql`，在 Docker CI 中输出真实数据库错误并保持与 API 测试初始化路径一致。
- Portal Vitest API/UI project 显式声明 `@ -> src` alias，避免测试 helper 中的 `@/db/schema` 因项目级解析缺口在容器内整批退化为 `ERR_MODULE_NOT_FOUND`。

## 原则

可执行入口必须只有一条默认真相源。凡是会影响 schema、发布验收、测试前置条件的命令，都必须在本地开发、GitHub runner、发布栈和文档中保持同一路径；否则“能跑通”只是偶然，不能证明系统可交付。

构建系统生成的开发态缓存不是源码的一部分。类型检查必须只依赖源码与稳定生成物，不能把 `.next/dev`、临时报告、历史诊断快照当作门禁输入，否则删除过的实现会通过陈旧索引“复活”。

## 验证

- 搜索仓库中的初始化文案，确认默认数据库初始化步骤已改为 `db:migrate`。
- PR/Main workflow 通过 `docker compose -f docker-compose.test.yml run --rm node-test ...` 执行 lint/typecheck/migrate/seed/test；`node-test` 通过 Compose 服务名 `postgres`、`redis` 访问依赖，不再依赖宿主机 `127.0.0.1` 端口暴露。
- PR/Main workflow 都在同一 Compose 网络内执行 `db:migrate` 后再执行 `db:seed`，测试前置数据不再依赖分支路径差异。
- `pr.yml`、`main.yml` 与 `release-validation.yml` 现在统一通过 `.github/workflows/validation-suite.yml` 复用同一套 job 定义，release 不再是“只跑 E2E 的缩水门禁”。
- `.github/workflows` 中不再保留任何面向生产数据库的定时维护任务；GitHub 只验证代码与镜像基线，不承担运行时分区清理职责。
- release validation 改为在 Playwright Docker 镜像中执行 `pnpm test:e2e:release`，发布验收链路也完全 Docker 化。
- 发布验收栈不再使用 `db:push --force`，避免绕过 migration history。
- `apps/portal` 不再保留和 `db:seed` 语义重叠的 `seed` 别名。
- 根 `package.json` 不再保留与原生命令完全等价且无消费者的 `infra:up` 空别名。
- `db:cleanup` 与 `cleanup-expired-tokens.ts` 在 package、CI、文档中均不再有入口。
- `apps/portal/tsc_output.txt` 不再入库，后续本地诊断不会形成无意义提交。
- `apps/portal/tsconfig.json` 不再扫描 `.next/dev/types`，本地 `typecheck` 不会再因为已删除的 `/api/telemetry` 幽灵路由立即失败。
- 组件、领域与 helper 测试不再因为共享 Portal 全局 `globalSetup` 而强制连接数据库；Docker 基线只作用于真正需要集成基础设施的 API 测试。
- `packages/contracts` 不再导出未被运行时使用的 `LOGIN_LOG_PERMISSIONS`，活跃规范文档中的登录日志权限也同步收敛为 `portal:audit:*`。
- `pnpm db:migrate` 在 `docker compose -f docker-compose.test.yml run --rm node-test ...` 中已可直接输出 migration 文件名和真实 SQL 失败点，不再只返回无上下文的 `drizzle-kit migrate Exit 1`。
- 完整 `pnpm test:api` 已在更新后的 `node-test` 镜像中通过，证明 Vitest project 的 `@` alias 与 Docker 网络化测试基线一致可执行。
