# 测试真实性治理 —— 假绿的识别、变异验证与机械规则

> 日期：2026-10-12
> 来源：wayfinder 地图「测试真实性：治理整体 mock 生产模块与假绿断言」的全量普查与逐票决议
> 关联 ADR：**ADR-022**（测试真实性策略）、ADR-017（深 module 与判别式失败）、ADR-018（权限上下文故障分级）、ADR-019（约束未强制的教训）、ADR-014（核心约束不得文档化多处而不触发）
> 词汇：module / interface / seam / depth（codebase-design）；假绿 / 真实驱动 / 债务快照 / 变异验证（本文件定义）

## 一、问题现象

全仓 79 个测试文件在基线 `ad530d6` 上**全绿**（76 文件 / 644 用例），但真实执行的变异实验显示这份安全网在多处**不拦任何东西**：

| 变异（临时改生产代码，跑完 `git checkout` 还原） | 结果 |
|---|---|
| 删掉 `issueRefreshToken` 唯一的 DB 写入 | 4 文件 / **44 例全绿** |
| 删掉 `logout` 的第 3 层（按 Cookie 撤销当前 Refresh Token） | **6 例全绿** |
| 删掉 `verifyAccessToken` 的 jti 黑名单校验 | `oauth-revoke` **11 例全绿**、`token-claims-binding` **18 例全绿** |
| 把 `REDIS_URL` 指向死端口（无真实 Redis） | **434 绿 / 3 红**，其中 2 条"撤销有效"断言**天然为真** |

最后一行是最危险的一条：缺真实 Redis 时不是"全绿"，而是 **2 条天然为真 + 3 条假红**的混合信号——3 条噪声出现在"不得撤销"的负例上，容易被误诊为"撤销逻辑允许越权"，而真正的空洞（tautology）被噪声掩盖。

## 二、根因分析

### 5-Why

1. 为什么删掉整段安全逻辑测试仍全绿？——断言落在测试自己写的替身上，而不是生产实现上。
2. 为什么会这样写？——测试替身（模块级 `vi.mock`）**没有任何架构约束**：把生产模块整体换成自造实现，成本比接真实基础设施低得多。
3. 为什么没人发现？——两类漂移**不会让任何测试变红**：mock 是真实模块的"超集"（多余键永不报错），且 mock 的值形状无人比对。
4. 为什么守卫没发现？——仓库里唯一的守卫 `mock-contract.test.ts` 只比对 `Function.length`，且它守护的 `mock-factory.ts` **实测 0 个真实采用者**。**守卫写了 ≠ 守住了。**
5. 为什么环境也没兜住？——`vitest.globalSetup.ts` 只探 PostgreSQL，Redis 从未被探测；"真实基础设施基线"只是恰好本机起了容器。

### 归因（三条独立病根）

| 病根 | 表现 | 反例（做对了的地方） |
|---|---|---|
| **替身无约束** | 78 处生产模块 mock 里 42 处确定假绿 | `rt-reuse-detection.test.ts` 对同一变异**会**变红（M3 对照） |
| **契约漂移不可见** | 14 处幽灵键（`@/lib/auth` 的 `getUserRoleDeptIds`/`canAccessDept` 等）+ 4 处陈旧形状 | `authz-surface.test.ts` 用真实 `import()` 钉住公开面 |
| **环境不被强制** | 同一变异在有/无 Redis 下结论相反（M4 vs M5） | `brute-force.test.ts:32-38` 的可抛错 fake 是唯一真正模拟"Redis 抛错"的形态 |

## 三、纠正措施

七张票据逐条落成 [ADR-022](../adr/ADR-022-test-authenticity-strategy.md) 的八条决策：

1. **边界显式化**：生产业务模块 vs 基础设施/框架；豁免清单写死在规则里（`@/lib/env`、`@/lib/logger` 也在清单内，不是默认漏网）。
2. **安全语义真实驱动**：真实 ES256（`seedJwks()`）+ 真实 PostgreSQL + 真实 Redis；判据 =「该 mock 是否替被测语义说话」。
3. **真实 Redis 进 API project**：`globalSetup` 硬探针（PING + 写读删 + `FLUSHDB` 校验，固定日志行作证据锚点）+ 专用逻辑库 + `vitest.api.setup.ts` 全局 `beforeEach` `FLUSHDB`（禁 `FLUSHALL`）+ 金丝雀测试；UI/domain project 不受影响。
4. **契约交给编译器**：类型化 mock 工厂 `vi.mock(import('@/lib/x'), (): Partial<typeof import('@/lib/x')> => ({…}))`，`pnpm typecheck` 阻断。
5. **理由注解 + 枚举**：`// @allow-module-mock <target> <reason-kind>: <理由>`，`target` 逐字校验。
6. **存量先记账、后清账**：规则上线当天的存量（机械生成 48 条）先入快照并标 owner，**只减不增**；#56 逐条结清后**快照机制（文件 / 比对函数 / 生成入口）整体撤除**——最终形态是**纯注解驱动，没有白名单**。
7. **不可变异两类转换变异通道**：A4 → 编译器可变异（改生产导出名 → tsc 必须报错）；A2 → 真实状态可变异（改坏生产逻辑 → 必须红）。
8. **零采用的基础设施即删**：`mock-redis.ts` / `mock-auth.ts` / `mock-factory.ts` / `mock-contract.test.ts`（净约 676 行）。

## 四、最佳实践沉淀

### 1. 假绿的判据：三级分类 + 五子码

- **A 确定假绿**：mock 了生产业务模块，且断言**只可能由 mock 行为满足**——把对应生产逻辑改坏不会变红。
  - **A1 值即 mock**：断言的期望值就是 mock 的返回值/参数（含 `mock.calls` 派生值）。
  - **A2 只断言调用**：该文件对这个 mock 的断言全部是 `toHaveBeenCalled*`。
  - **A3 mock 内手写重实现**：mock factory 里重新实现了被替换模块的业务逻辑，注释往往还声称"用的是真实实现"。
  - **A4 陈旧/幽灵合同**：mock 声明了生产模块**已不存在或从不曾存在**的导出，或返回已废弃的形状。
  - **A5 断言的分支在 mock 下不可达**：mock 的值让被测分支永不执行。
- **B 疑似假绿**：mock 了生产模块，但主要断言落在真实 DB / 真实领域代码上——它需要的是**理由注解**，不是重写。
- **C 合法**：`@/infrastructure/**`、`next/*`、`jose`、`ioredis`、驱动、跨包等。

识别时问三个问题：**这个 mock 替被测语义说话吗？改坏生产代码这一处会红吗？这个点位有没有真实替代物？**

### 2. 变异验证是判据，不是仪式

- **步骤**：临时改坏生产代码 → 跑定向用例 → 记录输出 → `git checkout` 还原。
- **必记三项**：变异 diff（改了哪一行）、命令、结果（绿/红 + 用例数）。
- **环境必须标注**：M4/M5 已证明同一变异在有/无 Redis 下结论相反。证据里必须逐字带上探针的固定行 `[globalSetup] Redis 就绪 …`。
- **没有信号通路时不要假装验证**：A4/A2 两类在原理上不可"改坏生产代码"验证，正确做法是**换一条变异通道**（编译器 / 真实状态），而不是写一句"已人工审查"。

### 3. 用编译器替代手写守卫（本次最可复用的结论）

手写守卫的三种死法，本仓库三种都踩过：

| 死法 | 实例 |
|---|---|
| 守卫与真身各自演化 | `mock-contract.test.ts` 的 `Function.length` 只读工厂初值，扫不到 `mock-factory.ts:189-193` 仍在的三参漂移 |
| 守一个没有消费者的对象 | 同一守卫保护的工厂实测 0 采用者 |
| 把"已删除"当"存在物"钉死 | `authz-surface.test.ts:28-29` 反向钉住已删的 `getUserRoleDeptIds`/`canAccessDept` |

类型化工厂把契约判定交给 `tsc`：它直接读真实模块类型，不需要维护副本，也不可能"忘了更新"。**结论：能用类型系统表达的契约，不要写运行时守卫。** 反过来，类型系统表达不了的（"为什么允许 mock 这个模块"），才用注解 + 守卫测试。

### 4. 规则两件套（快照退场后）：编译器管契约、守卫管理由

- 契约（键集/形状）→ 编译器；
- 理由（为什么允许）→ 注解 + 枚举 + 守卫（含 10 个违例夹具 + 1 条全量扫描断言，让守卫自己也被守）；
- 存量 → 曾有**只减不增**的债务快照（owner 必填、点位消失或补上注解即销账）；**#56 清账后连同快照机制一并删除**，今天任何新增点位都必须**当场**给出理由。

### 5. 环境基线必须被强制，否则结论是环境的函数

"恰好本机起了容器"不是基线。硬探针（连不上就 fail-fast + 可操作提示）+ 每用例隔离 + 一条金丝雀测试（`isJtiRevoked(未撤销 jti) === false`——fail-close 生效时它必红），三者合起来才能保证"测试通过"是代码的属性而不是环境的属性。

### 6. 夹具失效会与 mock 互相掩盖

`seedJwks()` 产出的私钥长期无法被 `jose` 导入（`Invalid keyData`），而"所有签发测试都整体 mock 掉 token 模块"让这个问题在测试里完全不可见。**夹具本身要有自检**（`fixture-keypair.test.ts` 就是为此而生），且自检不能依赖别处的 mock。

### 7. 零采用的基础设施即删

测试基础设施也会腐化：本次删除 5 组真实采用者为 0 的 adapter（含 238 行的内存 Redis fake）与 201 行"测这些死 adapter"的用例。**判据同测试替身：它替谁服务？** 删除要有顺序约束（先接真身、再拆替身），否则中间态无从验证。

### 8. 规范不得声称由工具强制，除非工具确实以该阈值运行

ADR-019 已经吃过一次（约束文档化 4 处、声称由 lint 强制、实际阈值是文档值的 4 倍且从未触发）。本策略的每条规则都写明**强制手段 + 阻断点 + 自检方式**（见 ADR-022 的「强制点」表），并且**零新增 CI 步骤**——复用既有的 `typecheck` 与 `test`，少一处会腐化的接线。

### 9. 夹具的加载期依赖会泄漏给它所有的导入者

把"要写 DB 并清生产模块缓存"的夹具（`seedSigningKeys`）并进"纯数据模板"模块（`seed-fixtures`）时，`user-api.test.ts` **整个文件 0 个用例**地跑不起来：

```
Error: [vitest] There was an error when mocking a module...
Caused by: ReferenceError: Cannot access '__vi_import_5__' before initialization
 ❯ __tests__/api/user-api.test.ts:49:3
```

根因不是"加载期碰了 DB"——绊线在 **`vi.mock` 工厂**：该文件的工厂 `() => ({ get db() {...}, schema })` 引用了**顶层 import**（`import * as schema from '@/db/schema'`）。任何在它之前请求 `@/infrastructure/db` 的模块，都会让这个工厂在 `schema` 绑定初始化之前执行，撞上 ESM 的 TDZ。夹具只需多出一条加载期依赖，就能远程引爆别的文件。

两条可复用结论：

- **夹具按"加载期依赖"分层**：纯数据模板一个模块；需要真实基础设施（DB、生产模块进程级状态）的种子独立成模块，**并且不进 helpers barrel**——barrel 会把这条边广播给每一个导入者。判据不是"是不是测试工具"，而是"导入它在加载期会拉进什么"。
- **`vi.mock` 工厂里引用顶层 import 是顺序敏感的脆弱写法**。安全形态是 holder + getter（`const { tdHolder } = vi.hoisted(...)` + `get db() { return tdHolder.current!.db; }`），本仓库 24 处先例即此。注意 getter 在 `td.connect()` 之前被访问会抛错，故 holder 必须在 `beforeAll` 之后才被触碰。

### 10. 夹具自检要覆盖"生产配置"，而不只是默认配置

`JWKS_ENCRYPTION_KEY` 未设置时 `encryptPrivateKey`/`decryptPrivateKey` 都是**直通**——于是私钥加密落库这条路径在所有测试里零覆盖，`decryptPrivateKey` 的 AES 分支从未执行过。夹具自检因此要成对：默认配置一条 + `vi.stubEnv('JWKS_ENCRYPTION_KEY', …)` 一条（并断言落库的是密文而非明文 JWK）。同理，闭环要用**生产函数**（`signAccessToken` → `verifyAccessToken`）而非只用 `jose` 手工签——只到 `jose` 那一层时，"改坏生产签发逻辑必红"并不成立。

### 11. 用"正向变异"证明 mock 与真身有类型联系

类型化工厂的价值在于**编译器知道真身长什么样**。要证明这一点存在（而不是"写了 `Partial<typeof x>` 就算数"），做法与证明测试有判别力同构——**换一条变异通道**：

1. **正向变异**：临时把生产模块里某个导出**改名**（如 `getUserPermissionContext` → `…RENAMED`），跑 `pnpm --filter @auth-sso/portal typecheck`。
   引用它的类型化工厂必须报错，且错误**点名到键**：
   `TS2561 Object literal may only specify known properties, but 'getUserPermissionContext' does not exist in type 'Partial<typeof import(…)>'. Did you mean to write 'cacheUserPermissionContext'?`
   （无可推荐名字时是同族的 `TS2353`；直接 import 真身的文件同时报 `TS2724`。）
2. **对照**：把工厂改成**裸写**（不标返回类型）后重复同一改名——分两种子形态：**不展开真身**时 `TS2769` 恒定报错（与键对错无关，属"构建失败"）；**展开真身**时**零诊断**（契约根本不生效，连弱报错都没有）。
3. 还原生产代码，`typecheck` 回到 0 错。三次输出都要贴进票据（含 Redis 就绪锚点行，若该次运行涉及 API project）。

结论固化在 ADR-022 §4(a)：**显式返回类型是这条契约唯一的信号产生点**。

## 五、同类问题审阅

- **Rust 侧**：`apps/gateway` 15 个含测试的文件未做同类普查；整体替换式 test double 的形态未评估。跨语言契约目前只靠 `gateway-identity-trust.test.ts` 与 `apps/gateway/src/http.rs` 的同向量测试锚定。
- **`@/hooks/**` 与 `@/components/**`**：已纳入规则射程，但只各 1 处与 3 处点位，尚未做变异验证。
- **生产缺陷**："把永不失败的调用当失败信号"在本仓库已出现 4 次（前 3 次已修，第 4 次 `refreshUsersPermissionCache` 把 DB 故障计成成功已单独立项）。测试真实性治理解决的是"缺陷不被发现"，不解决缺陷本身。
- **`token/route.ts` 双真相源**：实测已由 `fe3e17b` 收口，无需治理。

## 附：写新测试时的检查清单

1. 被测行为是**安全语义**吗？→ 必须走真实实现（真实密钥/真实 DB/真实 Redis）。
2. 需要 `vi.mock` 一个 `@/lib/**`、`@/domain/**`、`@/app/**`、`@/hooks/**`、`@/components/**` 模块吗？→ 写出 `// @allow-module-mock …` 注解（kind 选 `input-fixture` / `fault-injection` / `auth-bypass` / `infra-boundary`，`auth-bypass` 必须点名覆盖文件）。
3. 用了 `vi.mock`？→ 一律写成类型化工厂 `vi.mock(import('…'), (): Partial<typeof import('…')> => ({…}))`，并在写完后跑 `pnpm typecheck`。
4. 断言里出现 `toHaveBeenCalled*` 吗？→ 问一句"真实效果能不能直接断言"（Redis 键 / DB 行 / 可观测返回值）。
5. 注入故障吗？→ fake 必须**可抛错**；常量返回 `null` 的 fake 不算故障注入。
6. 别用 `@/infrastructure/redis` 的空模块 `{}`（那等于"Redis 永久宕机"，会激活生产不可达分支并让断言天然为真）。
7. 夹具改动后跑一次夹具自检；新写的回归测试做一次变异验证并记录输出（含 Redis 可用性行）。
8. 要新加测试夹具吗？→ 先问"导入它在加载期会拉进什么"：带 IO / 生产模块状态的夹具独立成模块且**不进 barrel**，否则会远程引爆那些把顶层 import 捕进 `vi.mock` 工厂的文件。
9. 夹具涉及**配置相关的分支**（加密、开关、TTL）吗？→ 默认配置与生产配置各写一条自检（如 `JWKS_ENCRYPTION_KEY` 开/关），别让默认配置的直通路径掩盖整条分支。
