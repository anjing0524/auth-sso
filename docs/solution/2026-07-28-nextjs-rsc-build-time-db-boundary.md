# Next.js RSC 构建期数据库边界收敛

## 问题

Portal 数据库基础设施在模块加载时立即通过 `getEnvConfig().DATABASE_URL` 解析环境变量并创建 Drizzle 客户端。Next.js 16 Cache Components 会在构建期求值 Route Handler 和 RSC 的模块图，而模块 import 属于可确定操作；因此即使路由最终在请求期执行，只要构建分析触碰到任意数据库 import 链，就会提前抛出 `DATABASE_URL` 缺失，表现为不同路由轮流出现 `Failed to collect page data`。

本地 Docker 构建一度错误通过，是因为 `.dockerignore` 没有排除 `.env.local`，`COPY . .` 把开发机的数据库配置复制进了构建上下文。这个配置既掩盖了 CI 的真实行为，也可能进入镜像构建层。

排除本地 env 后又暴露出两个共享边界问题：`getAppBaseURL()` 等公开配置 getter 复用全量 Portal schema，读取 OIDC URL 也会校验无关的 `DATABASE_URL`；鉴权 Controller 的 catch 把 Next.js headers/cookies/PPR 中断信号映射成 500，阻止框架将路由正确推迟到请求期。

## 根因

1. 数据库连接生命周期错误地绑定在 ES 模块生命周期上，而不是首次真实数据库访问。
2. 之前按失败堆栈在调用方逐个改成动态 import，只移动了触发点，没有修复共享基础设施边界。
3. 本地构建携带 `.env.local`，导致本地验证与无数据库配置的 CI 构建不等价。
4. 环境配置以全量 schema 作为所有 getter 的共同入口，无关依赖之间形成隐式启动耦合。
5. 领域错误映射层自行猜测 Next.js 内部 error 形态并返回 500，吞掉了框架控制流。

## 决策

- `apps/portal/src/infrastructure/db/index.ts` 负责唯一的惰性单例：导入模块和 schema 不读取环境变量，首次访问 `db` 时才校验 `DATABASE_URL` 并创建 Postgres/Drizzle 实例。
- 所有业务模块恢复普通静态 import，不再各自维护 `await import('@/infrastructure/db')` 补丁。数据库初始化策略只允许存在于 infrastructure 层。
- `@auth-sso/config` 的数据库、Redis、公开 URL、Cookie、Gateway secret 和日志 getter 分别只校验自身依赖；全量 `getEnvConfig()` 仅保留给确实需要完整 Portal 配置的运行时流程。
- 新增 server 横切错误入口：共享鉴权及相关 Controller catch 先调用 Next.js 官方 `unstable_rethrow()`，再把普通应用异常交给纯 domain 的 `mapDomainError()`。domain 不再识别任何 Next.js 内部 error。
- `/api/health` 与 `/api/auth/jwks` 没有可读取的 Request 参数，却必须每次请求实时探测外部依赖；仅这两个入口按官方语义在查询前调用 `connection()`，防止预渲染探测启动 DB/Redis。
- `.dockerignore` 排除根目录和子应用的真实 `.env*`，仅允许 `*.example` 进入构建上下文。构建所需的公开配置必须显式提供，运行时密钥不得依赖开发机文件。
- Route Handler 和页面遵循 Cache Components 语义，不导出 `dynamic`，也不把 `connection()` 用作模块副作用的补丁。

## 原则

Next.js 16 / RSC / Route Handler 的边界要分清：

- Cache Components 下页面默认动态，GET Route Handler 默认请求期执行，但框架仍会尝试提取可预渲染内容。
- 请求对象、运行时 API、异步网络或数据库查询会终止 GET Route Handler 的预渲染；模块 import 不会，它会在构建期正常求值。
- `connection()` 只保证它之后的代码等待真实请求，不能撤销模块顶层已经发生的环境校验或连接初始化。
- catch 可能同时接收应用异常和 Next.js `redirect()`、headers/cookies、PPR 控制流时，必须在 catch 顶部调用 `unstable_rethrow()`，不得根据 message/digest 猜测。
- `use cache` 明确表示允许缓存数据库查询结果；没有数据库构建环境时，受保护页面必须先经过请求期身份边界，不能在静态壳阶段直接执行该查询。
- 外部依赖客户端可以在模块内定义类型和惰性入口，但不得在 import 时解析必填运行时配置、建立连接或发起 I/O。

## 验证

- 19 个目标回归测试通过，覆盖 DB 导入纯度、单例初始化、配置关注点隔离、Next.js 控制流重抛和领域错误映射；全量 Vitest 41 个文件、349 个测试通过。
- Portal 与 config TypeScript 检查通过；Portal 全量 ESLint 为 0 error。
- Docker 构建日志不得再显示加载 `.env.local`，且在未传 `DATABASE_URL` 时完成 `next build`。
- 构建产物中的数据库 API 必须保持请求期动态；构建阶段不得出现鉴权层伪 500、`Failed to collect page data` 或 `DATABASE_URL expected string, received undefined`。
- CI 的 Gateway Release Journey 必须使用同一 Dockerfile 和干净构建上下文通过，防止本地环境再次掩盖问题。
