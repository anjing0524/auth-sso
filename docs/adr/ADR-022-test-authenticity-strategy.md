# ADR-022: 测试真实性策略 —— 禁止整体 mock 生产业务模块，安全语义由真实实现驱动

| 属性       | 值                                                                    |
|------------|-----------------------------------------------------------------------|
| **状态**   | **accepted**（2026-10-12）                                            |
| **日期**   | 2026-10-12                                                            |
| **决策者** | Auth-SSO 团队（wayfinder 地图「测试真实性：治理整体 mock 生产模块与假绿断言」） |
| **影响范围** | `apps/portal/vitest.api.config.ts`、`apps/portal/vitest.globalSetup.ts`、`apps/portal/vitest.redis.ts`（新增，地址解析与测试客户端工厂）、`apps/portal/vitest.api.setup.ts`（新增）、`apps/portal/__tests__/**`、`docs/portal-architecture-guidelines.md`、CI（**沿用现有门禁，零新增步骤**） |
| **取代**   | 部分取代 `docs/archive/solutions/2026-07-09-test-mock-strategy.md` 的「统一 Mock 工厂」路线（实测 0/17 采用者） |

## 背景：一份看着在、实际不拦的安全网

全仓 79 个测试文件普查（基线 `ad530d6`）的实测结果：

| 项 | 实测值 |
|---|---|
| `vi.mock(` 调用点 | **183** |
| 其中 mock **生产业务模块** | **78**（A 确定假绿 **42** + B 疑似 **36**） |
| 其中 mock 基础设施/框架 | 108（合法） |
| 测试文件总数 / 用例总数 | 76 / 644 全绿 |

**病灶不在代码量**：8 个文件整体 mock `@/lib/auth/token`，而这些 mock 声明**合计仅 39 行**（这 8 个文件本身合计 2308 行）。39 行换掉的是签发的全部安全语义。

真实执行的变异实验（M1–M5，逐条命令与输出见 `docs/research` 普查文档与各票据 resolution）：

| 变异 | 结果 | 含义 |
|---|---|---|
| **M1** 删掉 `issueRefreshToken` 唯一的 DB 写入 | 4 文件 / 44 例**全绿** | 刷新令牌的真实签发零覆盖 |
| **M2** 删掉 `logout` 第 3 层（按 Cookie 撤销 RT） | 6 例**全绿** | 根因是一行 `beforeEach` 把 Cookie 永久设为 `null` |
| **M3**（对照）删掉复用检测触发的家族级联撤销 | 2 例**变红** | 证明普查有判别力：假绿是局部而非全景 |
| **M4** 删掉 `verifyAccessToken` 的 jti 黑名单校验 | introspect 红 1；revoke 11 例全绿；claims-binding 18 例全绿 | 撤销端点没有任何断言证明"撤销后的令牌会被拒绝" |
| **M5** 把 `REDIS_URL` 指向死端口 | **434 绿 / 3 红** | 缺真实 Redis 不是全绿：2 条"撤销有效"天然为真、3 条"未撤销"变假红 |

**M5 是本 ADR 的方法论起点**：同一变异在有/无真实 Redis 下结论相反 —— 环境不被强制时，任何"测试通过"都可能只是环境的函数。

### 病根：测试替身没有架构约束

- **先例的教训**：`mock-contract.test.ts` 用 `Function.length` 作契约守卫，实测 **0 个真实采用者**（它守护的 `mock-factory.ts` 只被它自己引用），它宣称修掉的三参 `withPermission` 漂移**仍然活着**（`mock-factory.ts:189-193`），同时把已删除的 `getUserRoleDeptIds`/`canAccessDept` 当存在物**反向钉死**（`authz-surface.test.ts:28-29`）。**守卫写了 ≠ 守住了。**
- **测试基础设施同样无约束**：`helpers/` 下 5 组 adapter（`mock-redis.ts` 238 行等）真实采用者为 **0**，却由 201 行 `helpers.test.ts` 提供"看起来有覆盖"的假象。
- **夹具失效与 mock 互相掩盖**：`seedJwks()` 产出的私钥长期无法被 `jose` 导入，而"所有签发测试都整体 mock 掉 token 模块"使这个问题**在测试里完全不可见**。

### 环境前提缺失：真实 Redis 基线从来不存在

`vitest.globalSetup.ts` 只探 PostgreSQL（`:86-91`），没有任何 Redis 探测；15 个文件 mock `@/infrastructure/redis`；`AGENTS.md:119` 声称的"PostgreSQL/Redis 真实基础设施基线"在 Redis 一侧**只是恰好本机起了容器**。更糟的是混合信号——缺 Redis 时"撤销有效"类断言天然为真，掩盖了真正的空洞。

## 决策

### 1. 边界：生产业务模块 vs 基础设施 / 框架

**生产业务模块**（须受规则约束）：`@/lib/**`、`@/domain/**`、`@/app/**`、`@/hooks/**`、`@/components/**`。

**明确豁免**（不进规则射程，写死在守卫的豁免清单里，不是"默认漏网"）：`@/infrastructure/**`、`next/*`、`jose`、`ioredis`、`postgres`、`drizzle-orm/*`、`react`、`server-only`、`cmdk`、`@auth-sso/*`、`@/lib/env`、`@/lib/logger`。

Rust 侧（`apps/gateway`）不在本策略射程；跨语言契约继续由 `gateway-identity-trust.test.ts` 与 `apps/gateway/src/http.rs` 的同向量测试锚定。

### 2. 安全语义由**真实实现**驱动

安全语义（令牌签发与验签、撤销与其生效、权限上下文分级、身份信任边界、密码校验与暴力破解计数）必须由**真实实现**驱动：

- 真实 ES256（`seedJwks()` 提供的真密钥对，经 `jose` 真实验签）；
- 真实 PostgreSQL（`test-db.ts` 的 `TRUNCATE CASCADE` 隔离）；
- 真实 Redis（见第 5 条）。

**判据**（后续同类判定的通用标准）：看该 mock **是否替被测语义说话**。替语义说话者一律换真实；只提供输入、或注入真实实现无法产生的故障者，才可保留。

### 3. 故障注入只允许**可抛错的类型化 mock**

- Redis/DB 故障降级路径只能由**可抛错**的 fake 注入。常量 `get: async () => null` 且永不抛错的 fake **不构成故障注入**（它测的是"缓存未命中"，不是"基础设施故障"）。
- 故障注入点必须是**类型化 mock**（见第 4 条），并带 `fault-injection` 理由注解。
- **禁止**为让故障可注入而改动生产接口（零 seam 约束；见第 6 条）。

### 4. 机械规则：编译器管契约、守卫测试管理由、快照管存量

**（a）类型化 mock 工厂** —— 契约（mock 键集 ⊆ 真实导出集 + 判别式形状）**交给编译器**：

```ts
import type * as permissionsModule from '@/lib/permissions';

// @allow-module-mock @/lib/permissions fault-injection: 真实 PostgreSQL 无法按需变为不可用
vi.mock(import('@/lib/permissions'), (): Partial<typeof permissionsModule> => ({
  getUserPermissionContext: vi.fn(async () => ({ kind: 'unavailable' })),
}));
```

- 幽灵键 → **`TS2561`**（`Object literal may only specify known properties, but 'x' does not exist in type 'Partial<typeof import(…)>'. Did you mean to write 'y'?`）——**点名到键**并给出候选；同类但无可推荐名字时为 `TS2353`。直接 `import` 真身导出时：**有拼写候选名 ⇒ `TS2724`**，无候选名 ⇒ `TS2305`（两者都不是无条件错误码）。陈旧判别式形状 → `TS2769`。
- **必须显式标注返回类型**（#51 实测 + 评审复测）：标注后幽灵键必报错。**裸写要分两种子形态**——①**不展开真身**（`vi.mock(import(…), () => ({…}))`）：`TS2769`（No overload matches this call）**恒定成立、与键对错无关**（键全合法同样报），即"构建直接失败"而非"能定位到键"；②**展开真身**（`async (importOriginal) => ({ ...(await importOriginal()), ghost })`）：幽灵键**零诊断**，即完全不报错。两种子形态因此指向同一结论：显式返回类型是唯一能**点名到键**的信号产生点（原文只记了子形态①的 TS2769，复核时把子形态②的零诊断误推广为通例，此处按实测二分）；
- **返回类型必须写成顶层 type-only 命名空间别名**（`import type * as x from '…'` + `Partial<typeof x>`），**不能**内联 `Partial<typeof import('…')>`：仓库的 `consistent-type-imports`（`inline-type-imports` 风格）把 inline `import()` 类型标注判为违规（实现 #41 时实测报 `` `import()` type annotations are forbidden ``）。首参仍用 `import('…')` 值形态——不在该规则管辖内。
- 需要保留模块其余部分真实时用 `importOriginal()` 展开真身再覆盖单个导出（"只替换替语义说话的那一半"）；此时注解的 kind 只对**被替换的那些导出**成立。
- 强制点 = 既有的 `pnpm --filter @auth-sso/portal typecheck`（`apps/portal/tsconfig.json` 的 `**/*.ts` 覆盖 `__tests__/**`）。
- **不使用**手写"扫 mock 键集"的运行时守卫，也**不自写 TS 编译器 API 扫描**：编译器直接读真实模块类型，不存在"守卫与真身各自演化"的空间——那正是 `Function.length` 守卫失败的根因。

**（b）理由注解** —— 生产业务模块的模块级 mock 必须带：

```
// @allow-module-mock <target> <reason-kind>: <理由>
vi.mock('<target>', () => ({ … }));
```

- 注解必须紧邻 `vi.mock(` 的**上一行**；`<target>` 与首参**逐字一致**（守卫校验，防复制粘贴错位）；
- `<reason-kind>` ∈ 枚举：`infra-boundary`（被替代者其实是基础设施伪装）｜ `input-fixture`（只提供输入，断言落真实实现）｜ `fault-injection`（注入真实实现无法产生的故障，必须可抛错）｜ `auth-bypass`（旁路鉴权，自由文本**必须点名覆盖它的文件**）；
- **禁止**"历史原因 / 暂时 / 先这样"一类自由文本作为合法理由——理由只能落进上面的枚举（守卫按枚举机械拒绝）。

**（c）债务快照（历史机制，已于 #56 撤除）** —— 规则上线当天的存量曾记入 `apps/portal/__tests__/fixtures/module-mock-baseline.json`：

- 每条带 `class`（`debt` = A 类假绿待治理 / `annotate-later` = B 类只需补注解）与 `owner`（治理票号或 `legit`），**无主即红**；
- **只减不增**：条目不得新增；点位已消失或已补合法注解后仍留账单，也变红；
- **结局（#56）**：机械生成的 48 条存量逐条结清（44 条补合法注解、4 处 `hashToken` 恒等替身改走真身），随后**快照文件、`compareSnapshot` 比对函数与 `UPDATE_MODULE_MOCK_BASELINE` 生成入口全部删除**，守卫不再有"被账单容忍"分支——规则退化为**纯注解驱动**，**没有永久白名单**。
- **曾如实留档、现已闭环的一条边界**：`force-logout-route.test.ts` 的 `revokedJtiCount` 一度由 mock 提供计数（只锁响应投影）。#57 已把它改成**真实驱动**——删除 `@/lib/session/revoke` 的整体 mock，用真实 `trackUserJti` 播种 `user_jti`、断言真实计数与真实黑名单效果，并把"只执行一次"改为幂等空转的行为证据（变异：破坏计数来源 ⇒ 2 例红）。至此**规则里不再有任何 A 类边界留档**。

**（d）守卫测试**：`apps/portal/__tests__/api/module-mock-guard.test.ts`（API project 内、纯 `fs` 文本扫描、零 IO），扫描 `apps/portal/__tests__/**`、`apps/portal/src/**/*.test.{ts,tsx}`、`packages/contracts/src/**`、`tests/e2e/*.spec.ts`。守卫的判定逻辑抽成纯函数，并由 **9 个违例夹具 + 1 条全量扫描断言**（缺注解 / target 不一致 / kind 非法 / 孤儿注解 / auth-bypass 未点名 / 豁免清单生效 / 注解贴错位置 / 注释引用不算点位 / **不得把下一条 mock 的目标算到上一条** / 目标无法识别）在 CI 里真跑 —— 这是对 ADR-019「约束文档化 4 处、声称由工具强制、实际从未触发」的机械回应。

### 5. 环境基线：真实 Redis 进 API project

- **机制**：复用 `docker-compose.yml` 的 `redis:7` + `vitest.globalSetup.ts` 硬探针（与 PostgreSQL 同体例：`PING` + 写读删往返 + `FLUSHDB` 生效校验），失败即**硬失败**并给出可操作提示。**否决 testcontainers**（需 Docker socket，与既有 compose 基线重复）。
- **隔离**：API project 专用**逻辑库**（`TEST_REDIS_URL ?? REDIS_URL ?? 127.0.0.1:6379`，未显式带逻辑库时补 `/1`，经 `test.env` 决定性覆盖）+ `vitest.api.setup.ts` 的全局 `beforeEach` 用**独立 ioredis 客户端**执行 `FLUSHDB`（**禁 `FLUSHALL`**）。
- **UI/domain project 不依赖数据库**的硬约束不变：探针与 flush 只挂在 API project 的配置文件里（验收证据：停掉 Redis 后 UI/contracts 仍全绿、API 快速失败）。
- **并行度**：维持 `fileParallelism: false` + `maxWorkers: 1`；明确接受"同一时刻只允许一个 API 测试进程使用同一逻辑库"，`TEST_REDIS_URL` 是逃生口，**不引入运行级锁**。
- **金丝雀**：`__tests__/api/redis-baseline.test.ts` 三例，其中两例是"守卫守卫"——一例断言全局钩子真的清了库，一例断言 `isJtiRevoked(未撤销 jti) === false`（fail-close 生效时必红）。
- **编排零改动**：本地 `docker compose up -d postgres redis`、CI `docker-compose.test.yml` 的 `node-test`（已 `depends_on: redis: service_healthy`）、`validation-suite.yml` 三处都不改。

### 6. 不可变异的两类：把"不可变异"转成"可变异"

普查 42 处确定假绿里有两类在原理上不可用"改坏生产代码"验证。做法不是新增守卫，而是**转换变异通道**：

| 类 | 转化 | 证据形态 |
|---|---|---|
| **A4 幽灵 mock 键与陈旧形状**（17 处） | 编译器可变异 | **正向变异**：临时重命名/改形生产模块的导出 → 所有引用它的类型化工厂**必须 `tsc` 报错**；不报错即证明该 mock 与真身没有类型联系 |
| **A2 只断言"mock 被调用"**（12 处） | 真实状态可变异 | 改坏生产逻辑（如去掉 `revokeJti` 的写入）→ 断言落真实状态的用例**必须红** |

**A2 的默认解法是"换真实实现 + 断言真实状态"（真实 Redis 键 / 真实 DB 行），零生产接口改动。** 只有在效果确实不可观测时才允许在**既有深 module 的返回值**里加判别式字段，且必须复用 ADR-017 §2 的判别式失败形态（先例：`session/revoke.ts` 的 `UserRevokeOutcome`、`permissions.ts` 的 `RefreshOutcome`）并逐例论证。**禁止**为测试新增 DI 容器、抽象层或返回值。

### 7. 零真实采用者的测试基础设施即删

判据同第 2 条：它替谁服务？--- `helpers/mock-redis.ts`（不可注入错误的内存 fake，真实 Redis 落地后存在理由消失）、`helpers/mock-auth.ts`、`helpers/mock-factory.ts`、`mock-contract.test.ts` 及其死导出**全部删除**（净约 676 行），`helpers.test.ts` 收敛为在用 helper 的自检。可抛错 fake 按先例（`brute-force.test.ts`）在需要的文件内联，**不重建 adapter**。

**顺序约束**：先落地真实 Redis 与真实化改造，**再**删 adapter —— 不允许出现"删了替身、真身还没接上"的窗口。

### 8. 证据纪律

- **每个"换成真实实现"的测试必须做变异验证**（先例 `docs/solution/2026-10-08-data-scope-fail-open.md:76-85`）。
- 证据记录在**票据 resolution 与提交信息**里，逐字粘贴「变异 diff + 命令 + 输出」，并**必须标注 Redis 可用性**——锚点是 `vitest.globalSetup.ts` 打印的固定行：`[globalSetup] Redis 就绪 redis://***@127.0.0.1:6379/1`（M4/M5 已证明同一变异在有/无 Redis 下结论相反，不标注即不可复现）。
- 生产代码变异**不进 CI**（CI 里改源码是反模式且显著拉长门禁）；守卫自身的判定逻辑由第 4(d) 条的违例夹具在 CI 里覆盖。

## 后果

**收益**

- 安全语义重新有信号通路：M1/M2/M4 那类"整段逻辑删掉仍全绿"不再可能。
- 契约漂移由**编译器**在写代码时拦下，不再依赖"作者记得同步 mock"，也不再需要维护手写守卫。
- 环境不再是结论的函数：缺 Redis 会**硬失败**而不是给出 2 真 3 红的混合信号。
- 规则本体只存在于**一处**（本 ADR + 守卫的豁免清单/枚举），消解了 ADR-019 那类"文档化多处、声称被强制、实际从未触发"的漂移。

**代价**

- API project 的测试需要真实 PostgreSQL + 真实 Redis；本地开发必须先 `docker compose up -d postgres redis`（探针会给出明确提示）。
- 迁移期曾有债务快照（规则上线当天 78 处点位待销账）；**#56 结清后快照机制已撤除**，今天任何新增的生产模块 mock 都必须**当场**给出理由。
- 类型化工厂让每个 mock 多写一行 `(): Partial<typeof import('x')>`。

**未做 / 明确排除**

- 不给 UI/domain project 引入真实 Redis 或 DB（AGENTS.md 的硬约束保持）。
- 不为测试引入 DI 容器/抽象层；不引入 testcontainers。
- Rust 侧同类形态（整体替换式 test double）不在本策略射程，另立 effort。
- 生产缺陷本身的修复（如"把永不失败的调用当失败信号"第 4 处，见 issue #36）走 bug 流程，不属本策略。

## 强制点（机械可验，逐条可追溯）

| 规则 | 强制手段 | 阻断点 | 自检 |
|---|---|---|---|
| mock 键集 ⊆ 真实导出集、判别式形状 | 类型化 mock 工厂 | `pnpm typecheck`（`tsc --noEmit`） | 正向变异（第 6 条） |
| 生产模块 mock 必须带合法理由注解 | `module-mock-guard.test.ts` | `pnpm test`（现有 "Run unit, API, and component tests" 步骤） | 9 个违例夹具 + 1 条全量扫描 |
| 注解必须绑定到下一行 `vi.mock` 且 target 逐字一致（含豁免 mock） | `module-mock-guard.test.ts` | 同上 | 贴错位置 / 孤儿注解夹具 |
| 真实 Redis 在场 | `vitest.globalSetup.ts` 硬探针 | 任一 API 测试运行前 | 金丝雀测试 |
| 安全语义真实驱动 | 代码审查 + 本 ADR 第 2 条 | review | 逐点变异验证（记入票据） |

## 验证

- 本 ADR 的每条决策都能在 wayfinder 地图的子票据里找到实测依据：普查（M1–M5）、真实 Redis 基线决议、token 安全语义决议、8 文件逐个判定、adapter 删除决议、不可变异两类治理决议。
- 规则落地后的验收：`pnpm typecheck` + `pnpm test` 全绿；`docker compose stop redis` 时 API project **快速失败**而 UI/contracts 仍全绿；四条守卫变异（缺注解 / target 改字 / 退回字符串字面量 / 已销账点位重新加回 mock）各自变红。

## 参考来源

**一手来源（仓库内）**

- `apps/portal/vitest.globalSetup.ts`（探针与提示文案）、`apps/portal/vitest.api.config.ts:19-23`（串行与 include）、`apps/portal/vitest.setup.ts`（共享 setUp）
- `apps/portal/src/lib/session/revoke.ts:28-53`（`revokeJti` / `isJtiRevoked` 的 fail-close）、`apps/portal/src/lib/permissions.ts:116-137,266-270`（缓存读路径与收窄函数）、`apps/portal/src/lib/auth/token.ts:132-177,255-276`（黑名单校验与 RT 签发）
- `apps/portal/__tests__/api/mock-contract.test.ts`（反面教材）、`apps/portal/__tests__/api/authz-surface.test.ts`（静态公开面契约的正确形态）、`apps/portal/__tests__/api/brute-force.test.ts:32-38`（可抛错 fake 的先例）
- `docs/agents/domain.md`、`docs/portal-architecture-guidelines.md`

**决策链条（wayfinder 地图的子票据）**

- 全仓假绿普查（三级分类 A/B/C、五子码 A1–A5、M1–M5 变异实验、N1–N13 新增假绿）
- 真实 Redis 如何接进 API project（本 ADR 第 5 条）
- token 安全语义的真实覆盖（四个点位的真实驱动形态）
- 8 个 mock token 的文件逐个判定（逐文件"换真实/保留/删"）
- 零采用测试 adapter 与失效守卫的处置（本 ADR 第 7 条）
- 规则的机械形态与证据纪律（本 ADR 第 4 条）
- 不可变异验证的两类假绿怎么治理（本 ADR 第 6 条）

**先例与教训**

- `docs/solution/2026-10-08-data-scope-fail-open.md:76-85,103-121`（变异验证纪律；测试把缺陷固化成规范）
- `docs/adr/ADR-019-controller-length-constraint.md`（约束文档化多处却从未触发的教训）
- `docs/adr/ADR-017-authorization-code-grant-module.md`（深 module 与判别式失败；seam 判准）
- `docs/archive/solutions/2026-07-09-test-mock-strategy.md`（历史方案：Proxy mock 验证能力不足、统一 Mock 工厂 0/17 采用）
