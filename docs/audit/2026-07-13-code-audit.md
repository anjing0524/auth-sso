# 代码全维度审计报告

> **审计日期**：2026-07-13
> **项目**：auth-sso (v1.1.1.1)
> **审计范围**：全项目（Portal + Gateway + Contracts + Config + Tests）
> **综合评级**：**B**（架构 B+ | 代码质量 B- | 安全性 A- | 测试有效性 D | 可观测性 C- | 工程化 B-）
> **严重问题数**：18 个  |  **一般问题数**：42 个  |  **优化建议**：12 个

---

## 目录

1. [全局诊断报告](#1-全局诊断报告)
2. [分角色问题清单](#2-分角色问题清单)
3. [整体重构与规范方案](#3-整体重构与规范方案)
4. [核心模块优化示例](#4-核心模块优化示例)
5. [分阶段落地路线图](#5-分阶段落地路线图)
6. [长期维护规范](#6-长期维护规范)

---

## 1. 全局诊断报告

### 1.1 核心问题 TOP10

| 优先级 | 问题 | 严重度 | 影响面 | 复核状态 |
|:---:|------|:---:|------|:---:|
| 1 | **测试有效性严重不足**：17 个 API 测试文件中 7 个仅检查 `r.success`，未验证写入内容正确性 | 【严重】 | 所有 CRUD 写路径无安全网 | ✅已确认 |
| 2 | **CI 缺少依赖安全扫描**：PR/Main 工作流已有 `pnpm lint` + `pnpm typecheck`，但无 `pnpm audit` / `cargo audit` 依赖安全扫描 | 一般 | 已知 CVE 无法自动发现 | ⚠️已勘误 |
| 3 | **错误响应格式不统一**：系统存在 4 种互不一致的错误格式，facade 层缺少 `success: false` 字段 | 【严重】 | 约 13 个端点的错误响应违反 ApiResponse 契约 | ✅已确认 |
| 4 | **token.ts (实测 584 行) 和 gateway.rs (实测 853 行) 巨型文件**：违反单一职责，职责混杂 | 【严重】 | 维护困难，修改风险高 | ✅已确认 |
| 5 | **所有日志为非结构化纯文本**：`LOG_LEVEL` 配置未生效，无法在生产环境控制日志级别 | 【严重】 | 日志系统不可检索、不可聚合、不可控级 | ✅已确认 |
| 6 | **分页参数未统一校验**：`pageSize` 上限 100 散落 4 处，`access-logs` 缺失 Controller 层钳制 | 【严重】 | 资源耗尽风险 + 行为不一致 | ✅已确认 |
| 7 | **fire-and-forget 反模式泛滥**：密码重置 Token 撤销、登录日志更新、权限缓存写入均使用 `.catch()` 静默吞异常；复核另发现 `users/actions.ts:120,232,282` 与 `profile/actions.ts:124` 共 4 处同类安全关键 `revokeUserAccessByUserId(...).catch(...)` 遗漏 | 【严重】 | 关键安全操作失败无感知 | ⚠️已勘误（补充遗漏项） |
| 8 | **管理员角色硬编码**：`ProfileClient.tsx` 直接硬编码 `'SUPER_ADMIN' \|\| 'ADMIN'`，未引用 contracts 常量 | 【严重】 | 未来新增管理员角色会被遗漏 | ✅已确认 |
| 9 | **permissions 列表接口无分页**：直接返回全部权限记录，API.md 定义了分页参数但未实现 | 【严重】 | 权限数量增长后响应体积失控 | ✅已确认 |
| 10 | **auth-login 测试 mock 过度**：所有 6 个依赖被 mock，密码验证和会话签发逻辑从未真实测试 | 【严重】 | 核心安全行为无有效测试 | ✅已确认 |

### 1.2 分维度评级

| 维度 | 评级 | 关键依据 |
|------|:---:|------|
| **架构设计** | B+ | 分层清晰（Domain→Lib→API），零信任架构正确，但存在巨型文件和跨层耦合 |
| **代码质量** | B- | 大量 fire-and-forget、重复代码、命名不一致、魔法值散落 |
| **安全性** | A- | ES256 算法硬锁定、零信任清洗、时序安全比较均正确；Cookie Secure 依赖 NODE_ENV 有隐患 |
| **测试有效性** | **D** | 大量虚假覆盖率测试（仅 assert 200/success），核心写路径零有效测试 |
| **可观测性** | C- | 全量非结构化日志、LOG_LEVEL 不可用、无 trace-id、无 metrics 端点 |
| **工程化** | B | lint/typecheck CI 步骤已具备（见勘误 13.1）；缺依赖安全扫描（audit）；Docker 层缓存未优化 |

### 1.3 推荐核心优化方向

1. **建立测试有效性基线**：为所有 CRUD 操作补充验证写入内容的测试，删除或重写虚假覆盖率测试
2. **补齐 CI 静态分析**：加入 `pnpm lint` + `pnpm typecheck` + `pnpm audit` CI 步骤
3. **统一响应格式 + 消除 fire-and-forget**：建立全局错误处理中间件，统一 ApiResponse 格式
4. **日志结构化改造**：实现 `LOG_LEVEL` 过滤 + JSON 格式输出 + trace-id 传播
5. **拆分巨型文件**：token.ts 拆为密钥管理/JWT 签发/Token 轮换三个模块

---

## 2. 分角色问题清单

### 角色1：需求工程（6条）

| # | 文件:行 | 问题描述 | 等级 | 影响 | 依据 | 复核 |
|---|---------|---------|:---:|------|------|:---:|
| 1.1 | `domain/shared/zod-schemas.ts:40` | 密码策略与 API 文档不一致：文档要求 8 位，实际强制 10 位 + 3 类字符 | 一般 | 第三方集成方可能按文档实现弱密码策略 | API.md 1.4 节 vs 实际 Zod schema | ✅ |
| 1.2 | `api/auth/oauth2/userinfo/route.ts:39-45` | UserInfo 端点缺少 `preferred_username` 字段，依赖此字段的 OIDC Client 获取不到用户名 | 一般 | 功能不完整 | OIDC profile scope 标准预期 | ✅ |
| 1.3 | `api/telemetry/route.ts:11-22` | 遥测端点无 Zod 入参校验，任意 payload 可写入日志 | 一般 | 攻击者可注入垃圾数据淹没日志管道 | 无任何 Zod 导入 | ✅ |
| 1.4 | `docs/spec/REQUIREMENTS_MATRIX.md:62-70` | 模块 E（菜单管理）已废弃但未清理文档 | 优化 | 文档腐化，误导新成员 | contracts/index.ts 注释确认已合并 | ✅ |
| 1.5 | `api/auth/login/route.ts:79-80` | `lastLoginAt` 更新为 fire-and-forget，失败静默吞掉 | 一般 | 审计日志最后登录时间可能不准确 | `.catch()` 替代 `await` | ✅ |
| 1.6 | `api/auth/callback/route.ts:95-98` | Callback 强制要求 nonce Cookie，非 openid scope 场景会拒绝合法流程 | 一般 | 架构上存在隐性耦合 | 所有自登录含 openid scope，当前不触发 | ✅ |

### 角色2：流程标准化（4条，含合并）

| # | 文件:行 | 问题描述 | 等级 | 影响 | 依据 | 复核 |
|---|---------|---------|:---:|------|------|:---:|
| 2.1 | `lib/auth/facade.ts:56-59` + `api/permissions/register/route.ts:178` + 部分成功响应（`auth/login/route.ts:92`、`auth/logout/route.ts:129`、`telemetry/route.ts:28`） | **合并**：响应格式不一致 — facade 缺 `success: false`、register 用 `stats` 而非 `data`、部分成功响应仅 `{ success: true }` 无 `data` 字段（原报告称"审计 API 缺 `success: true`"经复核**不成立**，audit 三个 JSON 路由实际均带 `success: true`，已勘误） | **严重** | 多个端点违反 ApiResponse 契约 | contracts/index.ts ApiResponse 定义 | ⚠️已勘误 |
| 2.2 | `api/auth/refresh/route.ts:25` | `REFRESH_TOKEN_MISSING` 错误码不在契约文件 `errors.ts` 中 | 一般 | 客户端无法通过契约枚举所有错误码 | errors.ts 仅定义 REFRESH_TOKEN_INVALID/EXPIRED | ✅ |
| 2.3 | `api/permissions/register/route.ts:123-126` | 权限注册端点仅手动 `Array.isArray` 检查，无 Zod schema 校验字段 | 一般 | 非法数据可能在深层嵌套中产生难以排查的 DB 错误 | IncomingPermission 接口定义了 type 约束但未校验 | ✅ |
| 2.4 | `docs/spec/API.md` + `REQUIREMENTS_MATRIX.md` | 两份文档版本号体系不一致（API.md v2.0 vs 需求矩阵 v3.0） | 优化 | 文档维护混淆 | 版本号不统一 | ✅ |

### 角色3：系统架构（5条）

| # | 文件:行 | 问题描述 | 等级 | 影响 | 依据 | 复核 |
|---|---------|---------|:---:|------|------|:---:|
| 3.1 | `lib/auth/token.ts`（577行） | 巨型文件：密钥管理 + JWT 签发 + Refresh Token 轮换 + 撤销，4 个职责 | **严重** | 任何一处修改都可能影响其他职责 | 红线3：单文件 > 500 行 | ✅ |
| 3.2 | `apps/gateway/src/gateway.rs`（853行） | 巨型文件：ProxyHttp + Token 交换 + OAuth callback + Cookie 重写 + 身份注入 + HMAC，7 个职责 | **严重** | OAuth client 逻辑和 Proxy 逻辑耦合 | 红线3：单文件 > 500 行 | ✅ |
| 3.3 | `lib/auth/permissions-context.ts` | 引入中间层的理由（消除循环依赖）经分析不成立，依赖链实为单向无环 | 一般 | 架构注释与实际不符 | 实际 import 分析无 A→B→A 循环 | ✅ |
| 3.4 | `lib/auth/token.ts:91-98,141-148,162-168` | `JSON.parse→importJWK` 密钥导入模式重复 3 处，共 ~8 行 | 一般 | 算法变更需分别修改 3 处 | ≥3 处相同代码块 | ✅ |
| 3.5 | `lib/auth/facade.ts:16,48-82` | facade 层直接依赖 `NextResponse`（HTTP 框架类型），跨层耦合 | 一般 | 替换框架需修改 facade | 业务层依赖 UI/HTTP 对象 | ✅ |

### 角色4：数据建模（4条）

| # | 文件:行 | 问题描述 | 等级 | 影响 | 依据 | 复核 |
|---|---------|---------|:---:|------|------|:---:|
| 4.1 | `db/schema/auth.ts:56-70` | `authorization_codes.expires_at` 缺少索引 | 一般 | 定时清理任务全表扫描 | 对比同文件 accessTokens/refreshTokens 有索引 | ✅ |
| 4.2 | `lib/auth/token.ts:493` | `refresh_tokens` 轮换查询的复合条件索引不最优 | 一般 | 高并发续签时锁持有时间变长 | 查询条件 tokenHash+clientId+FOR UPDATE 的索引选择 | ✅ |
| 4.3 | `lib/auth/token.ts:277-296` | `signAccessToken` 中 Redis jti 写入与 DB 审计持久化分离且不一致 | 一般 | 若 DB insert 静默失败，审计表缺失记录 | 两个持久化步骤无原子性保证 | ✅ |
| 4.4 | `db/schema/users.ts:39` | `passwordHistory` 数组缺少 DB 层 CHECK 约束（仅应用层截断） | 一般 | 绕过应用层直接写库可产生无限大数组 | 对比 permissions 表有 CHECK 约束范例 | ✅ |

### 角色5：API 标准化（5条，含合并）

| # | 文件:行 | 问题描述 | 等级 | 影响 | 依据 | 复核 |
|---|---------|---------|:---:|------|------|:---:|
| 5.1 | `api/audit/access-logs/route.ts:16-23` + 4 个路由文件 | **合并**：`pageSize` 上限 100 散落 4 处，`access-logs` 缺失 Controller 层 NaN 保护，缺少统一常量 | **严重** | 资源耗尽风险 + 行为不一致 | Agent A 5.1 + Agent D 11.3 + Agent D 14.5 合并 | ✅ |
| 5.2 | `api/permissions/route.ts:12-18` | permissions 列表无分页支持，直接返回全部记录 | **严重** | 权限数量增长后响应体积失控 | API.md 7.1 节定义了分页参数但未实现 | ✅ |
| 5.3 | `api/me/route.ts` + `api/me/permissions/route.ts` | `/api/me` 返回平铺结构，`/api/me/permissions` 返回 `{data: {...}}` 嵌套结构，设计哲学不同 | 一般 | 前端需两套解析逻辑 | 两个端点同前缀但响应格式不同 | ✅ |
| 5.4 | `api/auth/oauth2/userinfo/route.ts:48` | UserInfo 端点 catch 块丢失 `message`/`error_description` 字段 | 一般 | 与 token/introspect 的 RFC 格式不一致 | 正常路径和异常路径错误格式不统一 | ✅ |
| 5.5 | `api/auth/oauth2/token/route.ts:43,155` | OAuth2 端点部分错误码直接书写字符串而非引用 contracts | 一般 | 增加维护风险 | `'invalid_request'` 等硬编码 vs AUTH_ERRORS 常量 | ✅ |

### 角色6：全链路实现（3条，部分合并到 fire-and-forget 类）

| # | 文件:行 | 问题描述 | 等级 | 影响 | 依据 | 复核 |
|---|---------|---------|:---:|------|------|:---:|
| 6.1 | `api/users/[id]/reset-password/route.ts:73-75` | 密码重置后 `revokeUserAccessByUserId` 为 fire-and-forget，Redis 不可达时旧 Token 仍有效。**复核遗漏（未修复）**：`users/actions.ts:120,232,282`（toggleUserStatus/deleteUser/resetPasswordAction Server Action）与 `profile/actions.ts:124`（用户自身改密）共 4 处同类 `revokeUserAccessByUserId(...).catch(...)` | **严重** | 违反"重置后所有会话立即失效"的安全要求 | REQUIREMENTS_MATRIX.md B-USR-PW | ⚠️已勘误（补充遗漏项） |
| 6.2 | `api/users/[id]/roles/route.ts:94-99` | 角色分配错误消息提取逻辑有 bug：`result.message` 访问了不存在的字段 | **严重** | 错误响应无描述信息，客户端只看到 `undefined` | result 类型中不含 `message` 字段 | ✅ |
| 6.3 | `api/auth/oauth2/introspect/route.ts:95-103` + `revoke/route.ts:79-87` | Introspect/Revoke 异常时返回正常响应（RFC 合规但无告警），Redis 故障时 Token 未被实际撤销 | 一般 | 内部故障无感知 | catch 块仅 console.error，无告警机制 | ✅ |

### 角色7：Clean Code（6条）

| # | 文件:行 | 问题描述 | 等级 | 影响 | 依据 | 复核 |
|---|---------|---------|:---:|------|------|:---:|
| 7.1 | `lib/auth/token.ts:471-561` | `rotateRefreshToken` 函数 91 行，包含事务查锁→吊销→签发新 RT→解析权限→签发新 AT→写缓存 6 个操作 | **严重** | 任何一步排查需阅读整个 91 行 | 红线3：单函数 > 80 行 | ✅ |
| 7.2 | `lib/audit.ts:42-59,98-118,173-192` | 审计日志写入代码三次重复，AST 相似度 > 90% | 一般 | 新增日志类型需复制函数体，修改容错策略需改三处 | ≥3 次相同调用序列 | ✅ |
| 7.3 | `lib/auth/verify-jwt.ts:32-40` | `EMPTY_CLAIMS` 使用空字符串表示"无值"，类型系统无法区分空值和无值 | 一般 | 下游代码若未做空值防御存在隐式语义 | `aud`/`jti` 为空字符串流向 Gateway 信任路径 | ✅ |
| 7.4 | `lib/auth/token.ts:568-577` | `revokeAllRefreshTokens` 中使用 `.then().catch()` 替代 `await`，与同文件其他模式不一致。复核：该函数用于账户封禁/强制下线，JTI 撤销静默失败时被封禁用户的 Access Token 仍有效至 TTL 过期 | **严重** | 调用方无法获知 Redis 撤销是否成功；被封禁用户 Access Token 仍有效 | 审计手册 7.8.1 | ⚠️已勘误（评级升级 一般→严重） |
| 7.5 | `domain/auth/types.ts` + `gateway/auth/mod.rs` | `PortalJwtClaims` 跨语言重复定义，字段集完全相同 | 一般 | 任何字段增减需手动同步两端 | 重叠率 100%，应建立 JSON Schema 权威定义 | ✅ |
| 7.6 | `token.ts` + `cookies.ts` + `authorize/route.ts` | 三种不同概念均使用 "session" 命名，阅读成本高 | 优化 | 同一文件中出现时易混淆 | LOGIN_SESSION vs COOKIE_NAMES.LOGIN_SESSION vs session_id | ✅ |

### 角色8：性能优化（3条）

| # | 文件:行 | 问题描述 | 等级 | 影响 | 依据 | 复核 |
|---|---------|---------|:---:|------|------|:---:|
| 8.1 | `lib/permissions.ts:63-81` | 权限查询使用 4 层嵌套 `.with()` 关联，选中所有中间表所有列 | 一般 | Redis 未命中时产生大量不必要数据传输 | 权限查询是高频操作 | ✅ |
| 8.2 | `infrastructure/redis/index.ts:58` | `lazyConnect: true` 导致首个请求触发 TCP 连接延迟 | 一般 | 冷启动首个请求延迟增加 | 生产环境建议预热连接 | ✅ |
| 8.3 | `gateway/src/auth/refresh.rs:168-182` | 续签去重使用两次独立 Redis 往返，可合并为 Lua 原子操作 | 优化 | 减少 1 次网络往返 | GET + SET NX EX 两次 RTT | ✅ |

### 角色9：应用安全（4条）

| # | 文件:行 | 问题描述 | 等级 | 影响 | 依据 | 复核 |
|---|---------|---------|:---:|------|------|:---:|
| 9.1 | `gateway/src/oauth.rs:272-288` | `decode_id_token_nonce` 使用手动字符串解析提取 nonce，转义字符可能导致绕过 | 一般 | nonce 校验可能被绕过 | `s.find("\"nonce\":\"")` 非标准 JSON 解析 | ✅ |
| 9.2 | `lib/auth/oauth-body.ts:19-45` | JSON 优先解析反模式：若攻击者发送合法 JSON 但语义错误的 form 编码内容可能绕过校验 | 一般 | RFC 6749 规定应优先 form-urlencoded | 仅在 JSON 解析失败时回退到 form | ✅ |
| 9.3 | `lib/session/cookies.ts:23,26,34,37` + `lib/oauth-utils.ts:40,44` | Cookie Secure 标志依赖 `NODE_ENV === 'production'`，语义不等价 | 一般 | 若 NODE_ENV 配置错误（如 staging），JWT 在 HTTP 明文传输 | NODE_ENV 语义是"构建模式"非"部署安全性" | ✅ |
| 9.4 | `gateway/src/config.rs:160-161` + `packages/config/src/env.ts:54` | `GATEWAY_SHARED_SECRET` 两端独立读取，对"未配置"的处理逻辑不一致 | 一般 | 可能导致信任路径不生效且无告警 | 两端无共享校验逻辑 | ✅ |

### 角色10：可观测性（5条）

| # | 文件:行 | 问题描述 | 等级 | 影响 | 依据 | 复核 |
|---|---------|---------|:---:|------|------|:---:|
| 10.1 | `packages/config/src/env.ts:39` | ~~`LOG_LEVEL` 定义但无代码读取~~ **【勘误：WIP 已创建 `lib/logger.ts`，`createLogger(component)` 支持 JSON 结构输出 + LOG_LEVEL 过滤 + component 标记，剩余工作是迁移 30 文件 68 处 console.* 调用】** | ~~**严重**~~ | — | 基础设施已就绪，迁移为体力活 | ⚠️已勘误（基础设施已完成） |
| 10.2 | `lib/permissions.ts` + `lib/auth/token.ts` + `lib/audit.ts` 等多处 | 所有日志为非结构化纯文本，剩余约 30 文件 68 处 console.* 待迁移到 `createLogger()` | 一般 | 日志无法按字段检索/聚合 | 结构化 logger 已就绪，迁移在途 | ⚠️已勘误 |
| 10.3 | `api/health/route.ts` | ~~健康检查仅返回 `{status: 'ok'}`~~ **【勘误：WIP 已实现完整健康检查，并行探测 DB（SELECT 1）+ Redis（PING），返回 `healthy/degraded/unhealthy` 三态，200/503 状态码】** | ~~一般~~ | — | 实测已实现 DB/Redis 探测 | ⚠️已勘误（已完成） |
| 10.4 | `lib/auth/server-logger.ts:18-48` | 缺少跨服务 trace-id 传播机制 | 一般 | Gateway↔Portal 请求无法串联排查 | Gateway 注入 X-Client-IP/UA 但无 trace-id | ✅ |
| 10.5 | `eslint.base.mjs:23` + `lib/permissions.ts` 等多处 | ESLint 禁止 `console.log` 但代码中大量违反，CI 无 lint 步骤 | 一般 | 代码风格不统一 | 有规则不执行 | ✅ |

### 角色11：兼容性（2条，含合并）

| # | 文件:行 | 问题描述 | 等级 | 影响 | 依据 | 复核 |
|---|---------|---------|:---:|------|------|:---:|
| 11.1 | `app/profile/ProfileClient.tsx:270` | 管理员角色硬编码 `'SUPER_ADMIN' \|\| 'ADMIN'`，未引用 contracts 的 `ADMIN_ROLE_CODES`（其他 5 处正确引用）。复核：`SUPER_ADMIN` 在可执行代码中仅此 1 处硬编码，另 `oauth-authorize.ts:32` 仅注释提及 | **严重** | 新增管理员角色时此处被遗漏 | Agent D 11.1 + 14.1 合并 | ⚠️已勘误（数量修正） |
| 11.2 | `domain/auth/brute-force.ts:15-16` | 暴力破解阈值（5 次/15 分钟）硬编码，不可通过环境变量调整 | 一般 | 不同环境需不同安全策略时须改代码 | 已 export 供测试但无配置注入 | ✅ |

### 角色12：质量管控（7条）

| # | 文件:行 | 问题描述 | 等级 | 影响 | 依据 | 复核 |
|---|---------|---------|:---:|------|------|:---:|
| 12.1 | `__tests__/api/audit-logging.test.ts:138-226` | 6 个测试仅断言 HTTP 200，未验证过滤/分页逻辑是否生效（虚假覆盖率） | **严重** | mock 返回空数据，无法区分过滤是否生效 | 参考文件 12.2.5 "集成测试仅检查 200" | ✅ |
| 12.2 | `__tests__/api/user-actions.test.ts:38-42` | 全部 5 个测试仅断言 `r.success`，从未验证写入内容正确性（无效测试） | **严重** | 用户创建/更新/删除的写路径无安全网 | 参考文件 12.2.1 "仅验证布尔返回值" | ✅ |
| 12.3 | `__tests__/api/permission-actions.test.ts:37-40` + `department-actions.test.ts:37-41` | 同为"仅 success 断言"模式，department 删除测试被注释跳过 | **严重** | 权限 CRUD 和部门删除无有效测试 | 与 12.2 相同反模式 | ✅ |
| 12.4 | `__tests__/api/auth-login.test.ts` | mock 所有 6 个依赖，密码验证和会话签发逻辑从未真实测试（mock 过度） | **严重** | 核心安全行为无有效测试 | 参考文件 12.2.2 "完全 Mock 无效测试" | ✅ |
| 12.5 | `__tests__/api/session-lifecycle.test.ts:96-117` | `jose` 库被 mock，JWT 验签逻辑被字符串等值比较替代 | 一般 | 签名无效/密钥过期等安全边界未测试 | `token === 'valid-jwt'` 替代真实加密验证 | ✅ |
| 12.6 | `tests/integration/` | 集成测试仅覆盖 OAuth 流程和 Session，零覆盖 CRUD write 路径 | 一般 | 用户/角色/权限的模块协作从未集成验证 | 2 个集成测试均只测认证流程 | ✅ |
| 12.7 | 14 个 API 测试文件 | 各测试文件各自内联实现 DB mock Proxy，大量重复 | 优化 | `createMockDb` 工厂无法覆盖多返回值场景 | 基础设施局限性迫使重复 | ✅ |

### 角色13：CI/CD 工程（4条）

| # | 文件:行 | 问题描述 | 等级 | 影响 | 依据 | 复核 |
|---|---------|---------|:---:|------|------|:---:|
| 13.1 | `.github/workflows/pr.yml` + `main.yml` | ~~PR/Main CI 均缺少 `pnpm lint` 和 `pnpm typecheck` 步骤~~ **【勘误：经复核，两个工作流均已包含 `pnpm lint`（pr.yml step5 / main.yml step5）与 `pnpm typecheck`（pr.yml step6 / main.yml step6），本条不成立】** | ~~**严重**~~ | — | 实测 step 序列含 lint + typecheck | ⚠️已勘误（撤销） |
| 13.2 | `.github/workflows/pr.yml` + `main.yml` | CI 缺少 `pnpm audit` / `cargo audit` 依赖安全扫描（`.github/` 下 grep audit/security/codeql/trivy/snyk 零命中） | 一般 | 已知 CVE 无法自动发现 | 依赖 jose/jsonwebtoken/bcryptjs 等安全敏感包 | ✅ |
| 13.3 | `apps/portal/Dockerfile:9-16` | Dockerfile 先 `COPY . .` 后 `pnpm install`，每次源码变更使依赖层缓存失效 | 一般 | 每次构建重新下载全部依赖，耗时数分钟 | 标准优化应先 COPY lockfile + install 再 COPY 源码 | ✅ |
| 13.4 | `apps/portal/tsconfig.json:14-16` | Portal 关闭了 base tsconfig 的 3 个 strict 子选项 | 一般 | 放宽类型安全：数组索引可能返回 undefined 不报错 | noUncheckedIndexedAccess 等三项被覆盖为 false | ✅ |

### 角色14：业务治理（4条，含合并）

| # | 文件:行 | 问题描述 | 等级 | 影响 | 依据 | 复核 |
|---|---------|---------|:---:|------|------|:---:|
| 14.1 | `lib/auth/token.ts:368` + `packages/contracts/src/oidc.ts:43` | `ID_TOKEN_TTL` 独立定义（3600），未引用 contracts 的 `TOKEN_TTL.ACCESS_TOKEN` | 一般 | Token TTL 值存在双源头，未来差异化需求需跨模块协调 | Agent D 11.4 + 14.2 合并 | ✅ |
| 14.2 | `app/audit/data.ts:77-81,113-117` | 日期范围验证逻辑在 audit_logs 和 login_logs 两个查询函数中完整重复 | 一般 | 相同的 startDate/endDate 格式校验 + DATE_REGEX 重复 2 次 | ≥2 处独立实现相同规则 | ✅ |
| 14.3 | `__tests__/api/department-actions.test.ts:41` | delete department 操作缺测试，注释声明"暂跳过" | 一般 | 部门删除防护规则（含子部门/用户拒绝删除）未验证 | 仅有 domain 层循环引用防护测试 | ✅ |
| 14.4 | `apps/portal/src/app/profile/ProfileClient.tsx:270` | 管理员角色硬编码（已在 11.1 详细记录） | _（去重）_ | — | 与 11.1 为同一问题 | ✅ |

---

## 3. 整体重构与规范方案

### 3.1 分层架构调整建议

当前架构（Portal）：
```
API Routes (HTTP层)
    ↓
Lib/Auth (认证逻辑 + 基础设施调用)
    ↓
Domain (纯业务规则，无 IO)
    ↓
Infrastructure (DB + Redis)
```

问题与调整：

1. **facade.ts 跨层耦合**（发现 3.5）：`lib/auth/facade.ts` 直接构造 `NextResponse`，应改为返回业务结果对象，由 API Route 层统一包装 HTTP 响应。

2. **巨型文件拆分**（发现 3.1, 3.2, 7.1）：
   - `token.ts` → `token/signing-keys.ts` + `token/issue.ts` + `token/rotate.ts` + `token/revoke.ts`
   - `gateway.rs` → 分离 `oauth_client.rs`（OAuth 2.1 Client 逻辑）
   - `rotateRefreshToken` → 提取 `validateAndRevokeOldRt` + `issueNewTokenPair`

3. **统一响应中间件**（发现 2.1）：
   建议新增 `lib/response.ts`，提供统一响应构造函数：
   ```ts
   // 统一成功响应
   function apiSuccess<T>(data: T, pagination?: Pagination): ApiSuccess<T>
   // 统一错误响应
   function apiError(code: string, message: string, status: number): ApiError
   ```

### 3.2 统一编码规范

| 规范项 | 现状 | 目标 |
|--------|------|------|
| **错误响应格式** | 4 种互不一致 | 统一为 `{success: false, error: CODE, message: MSG}`，OAuth2 再加 `error_description` |
| **成功列表响应** | 有/无 `success: true` 两种 | 统一为 `{success: true, data: T[], pagination: Pagination}` |
| **fire-and-forget** | 10+ 处 `.catch(console.error)` | 关键操作必须 `await`，非关键降级操作统一走 `backgroundTask()` 工具函数 |
| **分页参数** | `pageSize` 100 散落 4 处 | 在 contracts 中新增 `MAX_PAGE_SIZE = 100`，Controller 层统一引用 |
| **命名** | "session" 一词多义 | `LOGIN_SESSION` → `LOGIN_TOKEN`，`session_id` → `auth_request_id` |
| **魔法值** | 管理员角色/暴力破解阈值硬编码 | 全部迁移到 contracts 或环境变量配置 |

### 3.3 公共组件/工具抽取规划

| 工具 | 来源文件 | 目标位置 | 说明 |
|------|---------|---------|------|
| `writeLog(table, data)` | `lib/audit.ts`（3 次重复） | `lib/audit.ts` 内提取公共工厂 | 消除审计日志写入的三次重复 |
| `buildDateRangeConditions(params)` | `app/audit/data.ts`（2 次重复） | `lib/audit-utils.ts` | 提取日期范围过滤条件构建 |
| `importJwk(privateJwk)` | `lib/auth/token.ts`（3 次重复） | `lib/auth/token.ts` 内提取内部函数 | 消除密钥导入模式重复 |
| `parsePagination(sp)` | 4 个路由文件 | `lib/pagination.ts` | 统一分页参数解析 + 安全钳制 |
| `createMockDb` 增强 | `__tests__/helpers/mock-db.ts` | 原地增强 | 支持同次调用返回不同结果，减少测试文件重复 |

---

## 4. 核心模块优化示例

### 示例 1：统一 API 响应格式

**问题**：系统存在 4 种错误响应格式，facade 层缺少 `success: false`（发现 2.1）

**优化前** — `lib/auth/facade.ts:56-59`：
```ts
// 错误响应缺少 success: false，违反 ApiResponse 契约
return NextResponse.json(
  { error: COMMON_ERRORS.FORBIDDEN, message: check.error },
  { status: 403 }
);
```

**优化后**：
```ts
// lib/response.ts — 统一响应工具
export function apiError(code: string, message: string, status: number) {
  return NextResponse.json(
    { success: false, error: code, message },
    { status }
  );
}

// facade.ts — 使用统一工具
return apiError(COMMON_ERRORS.FORBIDDEN, check.error, 403);
```

**优化点**：
- ① 新增 `apiError` 工厂函数，集中管理错误响应格式
- ② 增加 `success: false` 字段，符合 `ApiError` 契约
- ③ 降低 13+ 个端点的格式漂移风险

---

### 示例 2：消除 fire-and-forget 反模式

**问题**：关键安全操作（密码重置后 Token 撤销）使用 `.catch()` 静默吞异常（发现 6.1）

**优化前** — `api/users/[id]/reset-password/route.ts:73-75`：
```ts
// 如果 Redis 不可达，旧 Token 仍然有效 — 安全风险
revokeUserAccessByUserId(id).catch((e) =>
  console.error('Failed to revoke access:', e)
);
```

**优化后**：
```ts
// lib/background.ts — 统一后台任务工具
export async function backgroundTask(
  name: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (e) {
    // 结构化告警日志（可被监控平台采集）
    console.error(JSON.stringify({
      level: 'ERROR',
      component: 'backgroundTask',
      task: name,
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    }));
  }
}

// reset-password/route.ts — 使用统一工具
await backgroundTask('revokeUserAccess', () => revokeUserAccessByUserId(id));
```

**优化点**：
- ① `backgroundTask` 统一后台任务失败日志格式，支持监控平台告警
- ② 关键安全操作使用 `await` 而非 `.catch()`，语义明确
- ③ 降级优雅但可观测：即使不阻断主流程，也能被监控采集

---

### 示例 3：测试有效性修复

**问题**：`user-actions.test.ts` 全部测试仅断言 `r.success`，从未验证写入内容（发现 12.2）

**优化前** — `__tests__/api/user-actions.test.ts:38-42`：
```ts
// 仅断言 success 布尔值 — 无效测试
it('create: 有效 → success', async () => {
  const r = await createUser(prevState, formData);
  expect(r.success).toBe(true);
  // 未验证：用户名是否正确写入？状态是否正确？字段是否完整？
});
```

**优化后**：
```ts
// 验证写入内容的正确性
it('create: 有效 → 返回完整用户数据', async () => {
  const r = await createUser(prevState, formData);
  expect(r.success).toBe(true);
  // 验证关键字段 — 核心业务逻辑被真正测试
  expect(r.data).toBeDefined();
  expect(r.data.username).toBe('testuser');
  expect(r.data.status).toBe('ACTIVE');
  expect(r.data.id).toBeDefined();
  // 验证副作用
  expect(mockDb.insert).toHaveBeenCalledTimes(1);
  const inserted = mockDb.insert.mock.calls[0][0];
  expect(inserted.username).toBe('testuser');
  expect(inserted.passwordHash).toBeDefined();
  expect(inserted.passwordHash).not.toBe('plaintext_password');
});
```

**优化点**：
- ① 验证返回数据的完整性（id、username、status）
- ② 验证 DB 写入的字段正确性
- ③ 验证密码被哈希处理（而非明文存储）
- ④ 从"执行即通过"提升为"行为验证"测试

---

## 5. 分阶段落地路线图

| 阶段 | 内容 | 涉及发现 | 预计工作量 | 风险点 | 可独立上线 |
|------|------|:---:|:--------:|--------|:--------:|
| **P0 紧急修复** | ① CI 加入依赖安全扫描（`pnpm audit` / `cargo audit`）；lint + typecheck 已具备（见勘误 13.1）<br>② 关键操作 fire-and-forget 改 await：含遗漏的 `users/actions.ts:120,232,282` + `profile/actions.ts:124`（6.1 复勘遗漏）<br>③ permissions 列表接口加分页<br>④ 分页参数统一校验 + 提取常量 | ~~13.1~~, 13.2, 6.1, 5.1, 5.2 | 3 人天 | — | ✅ |
| **P1 规范统一** | ① 统一 API 响应格式（ApiSuccess/ApiError）<br>② LOG_LEVEL 生效 + 日志结构化<br>③ 管理员角色硬编码改为引用 contracts<br>④ 统一 pageSize 常量 | 2.1, 10.1, 10.2, 11.1, 14.5 | 5 人天 | 响应格式变更需协调前端同步更新 | ✅ |
| **P2 公共抽取** | ① 审计日志写入抽取公共工厂<br>② 分页参数解析工具函数<br>③ 日期范围过滤条件构建<br>④ 密钥导入模式去重 | 7.2, 14.2, 3.4 | 3 人天 | 公共函数签名变更影响调用方 | ⚠️ |
| **P3 架构优化** | ① token.ts 拆分为 4 个模块<br>② gateway.rs 分离 OAuth client 逻辑<br>③ facade.ts 解耦 NextResponse<br>④ 健康检查加入 DB/Redis 探测 | 3.1, 3.2, 7.1, 3.5, 10.3 | 8 人天 | 巨型文件拆分可能引入回归 bug | ⚠️ |
| **P4 质量防护** | ① 重写虚假覆盖率测试（audit-logging, user-actions 等）<br>② 补充 CRUD write 路径集成测试<br>③ 补充 auth-login 真实密码验证测试<br>④ 建立测试有效性基线 | 12.1-12.7 | 10 人天 | 测试重写期间覆盖率可能短期下降 | ✅ |
| **P5 细节清洁** | ① Docker 层缓存优化 + .dockerignore<br>② tsconfig strict 子选项恢复<br>③ portalJwtClaims 跨语言契约<br>④ trace-id 传播 + metrics 端点<br>⑤ 文档版本号统一 | 13.3, 13.4, 7.5, 10.4, 2.4 | 5 人天 | 恢复 strict 可能暴露现有类型问题 | ✅ |

---

## 6. 长期维护规范

### 6.1 代码提交前自检清单

- [ ] `pnpm lint` 通过（无 warning）
- [ ] `pnpm typecheck` 通过
- [ ] 新增/修改的端点：响应格式符合 `ApiResponse` 契约（`success: true/false`）
- [ ] 无新增 `.catch(console.error)` fire-and-forget — 使用 `backgroundTask()` 替代
- [ ] 无明显硬编码魔法值 — 使用 contracts 常量或环境变量
- [ ] 无新增违反单一职责的巨型文件（> 500 行）或函数（> 80 行）
- [ ] 新增关键业务逻辑：测试验证了行为而非仅断言 `success` 布尔值
- [ ] 无绕过 contracts 直接书写字符串错误码

### 6.2 架构约束红线

1. **禁止 Domain 层依赖基础设施**：Domain 层文件不得 import `db`、`redis`、`NextResponse`、`cookies()`
2. **禁止 API Route 层包含业务逻辑**：Route handler 只做：解析入参 → 调用 Domain/Lib → 封装响应
3. **禁止跨语言类型重复定义**：TypeScript 和 Rust 共用的类型（如 JWT Claims）必须建立 JSON Schema 权威定义
4. **禁止新增不统一的错误响应格式**：新端点必须使用统一响应工厂函数
5. **文件行数上限**：单文件 500 行、单函数 80 行（不含注释和空行）

### 6.3 团队编码公约

1. **永远使用结构化日志**：`console.log(JSON.stringify({level, component, message, ...context}))` 替代纯文本
2. **关键操作必须 await**：密码重置、Token 撤销、权限刷新等安全操作不得 fire-and-forget
3. **分页接口三件套**：Controller 层钳制 + data 层 clamp + contracts 统一常量
4. **测试黄金法则**：测试必须验证行为而非代码执行路径 — 至少验证一个业务结果字段
5. **错误码来源唯一**：所有错误码必须定义在 `packages/contracts/src/errors.ts`，API Route 不得临时拼凑
6. **契约优先**：新增接口字段先更新 contracts，再更新实现，最后更新文档 — 三者顺序不可颠倒

---

*本报告由系统级全维度代码审计流水线自动生成，经 4 路并行 Agent 审计 + 1 路复核 Agent 交叉验证。*
*审计覆盖：88 个原始发现 → 去重合并为 72 个独立问题。*
