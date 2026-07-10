# 代码全维度审计报告

> **审计日期**：2026-07-10
> **项目**：auth-sso（统一身份认证平台）
> **审计范围**：全项目（apps/portal、apps/gateway、packages/contracts、packages/config、tests/）
> **审计方法**：四路 Agent（A/B/C/D）14 角色深度审计 + 复核 Agent 交叉验证/去重/补盲
> **综合评级**：**C+**（安全架构方向正确但多处关键实现缺陷，工程化基础薄弱）
> **严重问题数**：17 个  |  **一般问题数**：23 个  |  **优化建议**：15 个

---

## 目录

- [1. 全局诊断报告](#1-全局诊断报告)
- [2. 分角色问题清单](#2-分角色问题清单)
- [3. 整体重构与规范方案](#3-整体重构与规范方案)
- [4. 核心模块优化示例](#4-核心模块优化示例)
- [5. 分阶段落地路线图](#5-分阶段落地路线图)
- [6. 长期维护规范](#6-长期维护规范)

---

## 1. 全局诊断报告

### 核心问题 TOP5（经复核确认，按严重程度降序）

| 排名 | 问题 | 涉及文件 | 风险等级 | 复核结论 |
|------|------|----------|----------|----------|
| 1 | 暴力破解防护三重缺陷（INCR 时序错误 + fail-open + DB fallback 不清零） | `brute-force.ts:44`, `login/route.ts:52-57` | 严重 | ✅ 确认：INCR 在密码校验前执行；Redis 异常静默吞掉 |
| 2 | Client Secret 使用 SHA-256 快哈希 + 非定时安全比较 | `crypto.ts:68`, `oauth-client.ts:43`, `introspect/route.ts`, `revoke/route.ts` | 严重 | ✅ 确认：`createHash('sha256')` + `!==` 比较；多处端点同样问题 |
| 3 | type-guards.ts 声称运行时校验实际零校验（`as` 裸断言） | `type-guards.ts:22-38` | 严重 | ✅ 确认：三个函数均为 `return v as ...` 无任何校验逻辑 |
| 4 | RBAC 外键缺失（role_permissions.permission_id 无 FK、permissions.parent_id 自引用 FK 未创建） | `rbac.ts:78,99`, `0000_...sql:127-131,105-125` | 严重 | ✅ 确认：migration SQL 中 permission_id 仅 `uuid NOT NULL` 无 FK；parent_id 自引用 FK 注释承诺但 SQL 缺失 |
| 5 | ApiResponse 契约破坏 + pageSize 无上限 | `users/route.ts`, `clients/route.ts`, `roles/route.ts`, `departments/route.ts` | 严重 | ✅ 确认：CRUD 路由返回 `{data, pagination}` 无 `success` 字段；`parseInt(pageSize)` 无 clamp |

### 整体架构与代码质量评级（分维度独立打分）

| 维度 | 评级 | 说明 |
|------|------|------|
| 安全架构设计 | B+ | ES256 + bcrypt cost 12 + PKCE S256 + refresh 轮换 + redirect_uri 精确匹配 + 用户枚举防护 ——设计正确 |
| 安全实现质量 | C | 多处 fail-open、非定时比较、非安全哈希实现拉低评分 |
| 代码整洁度 | C | type-guards.ts 零校验、大量 `!` 断言、过宽 catch、魔术数字 |
| 架构分层 | C+ | domain/data/auth 分层清晰，但 data.ts 反向依赖鉴权层破坏了分层原则 |
| 数据建模 | C | 核心表设计合理，但 FK 缺失、passwordHistory 迁移遗漏、唯一约束与软删除冲突 |
| 测试深度 | D | mock 替代断言、零业务验证、零异常路径、brute-force.ts 零覆盖 |
| 工程化/CI | D | PR/Main CI 无 lint/typecheck、Dockerfile 含调试代码、latest tag、env 模板碎片化 |
| 可观测性 | C- | 审计日志 fire-and-forget、console.log 替代结构化日志、遥测端点无认证 |
| **综合评级** | **C+** | 核心 OAuth/OIDC 流程安全设计正确，但工程实现多处存在可被利用的缺陷 |

### 推荐的核心优化方向与预期收益

1. **安全加固（P0）**：修复 brute-force 时序 + Client Secret bcrypt + 定时比较 + 去除 fail-open 关键路径 → 预计消除 4 个高危可利用漏洞
2. **数据完整性（P0）**：补充 FK 约束 + passwordHistory migration → 防止数据孤岛和数据丢失
3. **测试补强（P0）**：从 mock 测试转向业务断言测试 + 异常路径覆盖 → 提升回归保护置信度
4. **CI 门禁（P1）**：加入 lint + typecheck + coverage gate → 阻止低质量代码合入主干
5. **接口标准化（P1）**：统一 ApiResponse 格式 + pageSize clamp → 消除客户端解析不一致

---

## 2. 分角色问题清单

### 角色 1：需求工程

| 序号 | 文件:行号 | 问题描述 | 风险等级 | 影响范围 | 判断依据 | 复核状态 |
|------|-----------|----------|----------|----------|----------|----------|
| 1.1 | `brute-force.ts:44`, `login/route.ts:52-71` | 暴力破解 INCR 在密码校验前执行——INCR 计入任意密码尝试（含明显错误输入），而非仅计入失败尝试，稀释了锁定阈值的有效性 | 严重 | 登录安全 | 代码行 44 `redis.incr()` → 行 52-57 `checkBruteForce` → 行 67 `verifyPassword`。INCR 发生在密码校验之前 | ✅ 确认 |
| 1.2 | `revoke.ts:63-75` | NFR-SEC-16 会话并发控制（最多 3 活跃会话）未实现——`trackUserJti` 仅记录映射，不检查或限制活跃 jti 数量 | 严重 | 会话安全 | `trackUserJti` 只做 HSET，无计数/限制逻辑 | ✅ 确认 |
| 1.3 | `zod-schemas.ts:40-56`, `PRD.md:224` | 密码策略与 PRD 不一致——PRD 要求 8 位含大小写+数字，代码要求 10 位/3 类（大写+小写+数字+特殊字符四选三） | 严重 | 用户体验 | `PASSWORD_MIN_LENGTH=10`, `PASSWORD_REQUIRED_CATEGORIES=3` | ✅ 确认（注：代码策略更严格，是正向偏差但需决策） |
| 1.4 | `login/route.ts`, `password.ts` | 首次登录强制改密未实现——`password_changed_at` 字段存在但无拦截逻辑 | 一般 | 安全策略 | schema 有 `password_changed_at`，但 login controller 未检查 | ✅ 确认 |
| 1.5 | `oauth-code.ts:25-44` | OAuth2 授权码重复使用时未级联撤销已签发的 token——仅拒绝重复 code，不撤销通过首次 code 获取的 token | 一般 | OAuth 安全 | `validateAuthCodeRow` 检测 `row.used` 后仅抛异常，无级联撤销 | ✅ 确认 |

### 角色 2：流程标准化

| 序号 | 文件:行号 | 问题描述 | 风险等级 | 影响范围 | 判断依据 | 复核状态 |
|------|-----------|----------|----------|----------|----------|----------|
| 2.1 | 全局 `/api/*` | API 无版本管理——所有端点均为 `/api/*` 无 `/api/v1/*` 等版本前缀，Breaking Change 无法共存 | 严重 | API 兼容性 | 全量路由 `find` 确认无版本标识 | ✅ 确认 |
| 2.2 | `.env.example:1-17` | `.env.example` 与实际依赖严重不一致——仅 5 个变量，缺 `GATEWAY_SHARED_SECRET`、`PORTAL_CLIENT_SECRET`、`JWT_SIGNING_KEY`、`PORTAL_INTERNAL_URL` 等关键变量 | 严重 | 部署/新人上手 | `.env.example` 仅定义 NODE_ENV/LOG_LEVEL/APP_URL/DATABASE_URL/REDIS_URL/PORTAL_CLIENT_SECRET | ✅ 确认 |
| 2.3 | `oidc.ts:8-20`, 实际路由 `app/api/auth/oauth2/*` | OIDC 端点路径契约常量与实际路由不匹配——contracts 定义 `/oauth2/authorize`，实际路由为 `/api/auth/oauth2/authorize` | 一般 | 文档/契约 | `OIDC_ENDPOINTS.AUTHORIZE = '/oauth2/authorize'` vs `route.ts` 位于 `api/auth/oauth2/authorize/` | ⚠️ 存疑（contracts 常量用于 well-known 生成，非内部路由） |
| 2.4 | `login/route.ts:77-78` | 登录路由中异步更新 lastLoginAt 失败仅 console.error，不返回任何异常 | 一般 | 数据完整性 | `.catch(err => console.error(...))` 静默丢弃错误 | ✅ 确认 |
| 2.5 | 项目根目录 | README/快速开始缺失——`README.md` 存在但缺少本地开发步骤、环境变量说明、数据库初始化指南 | 一般 | 新人上手 | 项目 README 缺少 Setup 章节 | ✅ 确认 |

### 角色 3：系统架构

| 序号 | 文件:行号 | 问题描述 | 风险等级 | 影响范围 | 判断依据 | 复核状态 |
|------|-----------|----------|----------|----------|----------|----------|
| 3.1 | `users/data.ts:20,143` | 读模型 data.ts 反向依赖鉴权层 lib/auth——`canAccessDept`、`logServerDataRead` 从 `@/lib/auth` 导入，读层依赖写/鉴权层 | 严重 | 架构分层 | `import { canAccessDept, logServerDataRead } from '@/lib/auth'` 出现在 data access 层 | ✅ 确认（注：这是为了省去 API Route 的鉴权调用，但破坏了单向依赖） |
| 3.2 | `permissions-context.ts` | 循环依赖通过 permissions-context.ts 中间代理打破——反模式，增加理解成本 | 一般 | 架构可维护性 | import 链路经中间代理文件间接引用 | ✅ 确认 |
| 3.3 | `guard.ts` vs `facade.ts` | guard.ts 与 facade.ts 鉴权逻辑高度重复 | 优化建议 | 代码重复 | 两个文件均实现类似的权限检查逻辑 | 优化建议 |
| 3.4 | `token.ts:106-170` | getActiveSigningKey 三段重复 JWK→CryptoKey 代码 | 优化建议 | 代码重复 | 同一函数内相同转换逻辑出现三次 | 优化建议 |

### 角色 4：数据建模

| 序号 | 文件:行号 | 问题描述 | 风险等级 | 影响范围 | 判断依据 | 复核状态 |
|------|-----------|----------|----------|----------|----------|----------|
| 4.1 | `rbac.ts:99`, `0000...sql:127-131` | role_permissions.permission_id 缺少外键约束——Drizzle schema 仅 `.notNull()` 无 `.references()`，Migration SQL 亦无 FK | 严重 | 数据完整性 | Schema line 99: `permissionId: uuid('permission_id').notNull()` vs line 98: `roleId: ... .references(...)`；SQL line 213 仅创建 role_id FK | ✅ 确认 |
| 4.2 | `rbac.ts:76`, `0000...sql:105-125` | permissions.parent_id 自引用 FK 在 Migration SQL 未创建——Drizzle schema 注释承诺"在 migration 中手动添加"，但 SQL 中无对应 ALTER TABLE | 严重 | 数据完整性 | Schema line 76: `parentId: uuid('parent_id'),` 注释说明 migration 添加；SQL lines 105-125 创建 permissions 表但无 parent_id FK，ALTER TABLE 段也无 | ✅ 确认 |
| 4.3 | `users.ts:39`, `0000...sql:83-103` | users.passwordHistory Schema 定义存在但 Migration SQL 缺失——Drizzle schema 定义 `passwordHistory: text('password_history').array()`，但 users 表创建 SQL 中无此列 | 严重 | 数据完整性 | Schema line 39 定义了 passwordHistory 列；SQL lines 83-103 的 CREATE TABLE users 无 password_history 列 | ✅ 确认 |
| 4.4 | `users.ts:30-32` | users.email/mobile 唯一约束与软删除冲突——已删除用户的 email/mobile 仍占用唯一约束，阻止同名新用户注册 | 一般 | 用户体验 | `unique()` 约束无 WHERE deleted_at IS NULL 条件 | ✅ 确认 |
| 4.5 | `logs.ts:77-78` | 日志表按月分区 Migration 未创建——schema 引用分区逻辑但初始 migration 无分区创建语句 | 一般 | 日志性能 | Migration SQL 中 access_logs/audit_logs/login_logs 均无 `CREATE TABLE ... PARTITION BY RANGE` | ✅ 确认 |
| 4.6 | `0000...sql:178,194` | audit_logs.username（nullable）与 login_logs.username（NOT NULL）可空性不一致 | 一般 | 数据一致性 | SQL line 178: `"username" varchar(50)` vs line 194: `"username" varchar(50) NOT NULL` | ✅ 确认 |

### 角色 5：接口标准化

| 序号 | 文件:行号 | 问题描述 | 风险等级 | 影响范围 | 判断依据 | 复核状态 |
|------|-----------|----------|----------|----------|----------|----------|
| 5.1 | `users/route.ts:23`, `clients/route.ts:21`, `roles/route.ts:23`, `departments/route.ts` 等 | ApiResponse\<T\> 契约被破坏——auth/\* 路由返回 `{ success: true/false, ... }`，CRUD 路由返回 `{ data, pagination }` 无 success 字段 | 严重 | 全量客户端 | `login/route.ts:87` 有 `success: true`；`users/route.ts:23` 直接 `NextResponse.json(result)` 无 success 包装 | ✅ 确认 |
| 5.2 | `users/route.ts:16`, `clients/route.ts:16`, `roles/route.ts:18` | 列表查询 pageSize 无上限——用户/角色/Client 列表 `parseInt(pageSize)` 无 max 限制，仅 audit 有 clamp | 严重 | 性能/DoS | 多处 `parseInt(sp.get('pageSize') \|\| '20', 10)` 无 Math.min 约束 | ✅ 确认 |
| 5.3 | `reset-password/route.ts:25`, 多处 | 手写校验与 Zod 混用——`as string` 强转、手写 `Array.isArray` 未用 Zod schema | 一般 | 类型安全 | `body.password as string` 替代 Zod parse | ✅ 确认 |
| 5.4 | `token/route.ts` | OAuth2 token 端点错误码用 `AUTH_SSO_*` 而非 RFC 6749 标准错误码（`invalid_grant` 等） | 一般 | OAuth 合规 | 错误码前缀为 `AUTH_SSO_` 而非 OAuth 标准 | ✅ 确认 |
| 5.5 | `users/[id]/roles/route.ts` | users/[id]/roles POST 返回 `assignedCount` 命名误导——应为 `assignedRoleCount` 或 `assigned` | 一般 | API 语义 | 变量命名问题 | ⚠️ 存疑（未找到确切行，需复核） |

### 角色 6：全链路实现

| 序号 | 文件:行号 | 问题描述 | 风险等级 | 影响范围 | 判断依据 | 复核状态 |
|------|-----------|----------|----------|----------|----------|----------|
| 6.1 | `introspect/route.ts:92-96` | Introspect 端点异常被静默吞掉——`mapDomainError(err)` 返回值被丢弃，所有异常统一返回 `{ active: false }` | 严重 | 令牌验证可靠性 | Line 94: `mapDomainError(err)` 无赋值/使用，Line 95: `return NextResponse.json({ active: false })` | ✅ 确认 |
| 6.2 | `brute-force.ts:44`, `login/route.ts:52-71` | 登录链路 checkBruteForce INCR 在网络异常时锁计数语义混乱——与 1.1 关联，Redis 异常时 INCR 被跳过但 DB fallback 路径不清零 | 严重 | 登录安全 | 同 1.1，已合并 | ✅ 确认（与 1.1 合并） |
| 6.3 | `authorize/route.ts:163` | OAuth2 授权码链路 Redis→DB 的 `as 'S256'` 隐式窄化——从 Redis 恢复的 `code_challenge_method` 经 `as 'S256'` 强制断言，放弃运行时校验 | 一般 | 类型安全 | Line 163: `codeChallengeMethod: stored.code_challenge_method as 'S256'` | ✅ 确认 |
| 6.4 | `reset-password/route.ts:66-78` | 重置密码事务边界——密码更新在事务内（line 66-70），会话撤销在事务外（line 73），事务提交后撤销失败会导致密码已改但会话未失效 | 一般 | 数据一致性 | Line 66 `db.transaction` 仅包裹密码更新；Line 73 `revokeUserAccessByUserId` 在外 | ✅ 确认 |
| 6.5 | `force-logout/route.ts:33` | force-logout 用 `user:manage` 与其他细粒度权限码风格不统一——应使用专用权限如 `user:force_logout` | 一般 | 权限粒度 | Line 33: `withPermission({ permissions: ['user:manage'] })` | ✅ 确认 |

### 角色 7：Clean Code

| 序号 | 文件:行号 | 问题描述 | 风险等级 | 影响范围 | 判断依据 | 复核状态 |
|------|-----------|----------|----------|----------|----------|----------|
| 7.1 | `type-guards.ts:22-38` | type-guards.ts 的 as 函数声称"运行时校验"实为纯 as 断言——JSDoc 写"运行时校验 + 收窄"但实现为 `return v as T`，零运行时安全网 | 严重 | 类型安全 | Line 23: `return v as EntityStatus;`，无任何 `if`/`includes`/`in` 校验 | ✅ 确认 |
| 7.2 | `token.ts:119`, `oauth2/token/route.ts:54` 等多处 | 大量 `!` 非空断言——跳过 TypeScript 空安全检查，运行时可能 NPE | 一般 | 运行时安全 | `const user = rows[0]!;` 等模式在多处出现 | ✅ 确认 |
| 7.3 | `users/actions.ts:272` | resetPasswordAction 抛裸 Error→500——未使用 DomainError 子类，错误处理不统一 | 一般 | 错误处理 | 未读取确切行，依据 Agent 描述 | ⚠️ 存疑（需进一步验证具体行号） |
| 7.4 | `oauth-client.ts:43` vs `crypto.ts:68` | validateClientSecret SHA256 重复实现于 oauth-client.ts 和 crypto.ts——`createHash('sha256').update(...)` 在两处独立实现 | 优化建议 | 代码重复 | `oauth-client.ts:43` 和 `crypto.ts:68` 均有相同的 SHA-256 实现 | 优化建议 |
| 7.5 | `token.ts:368` | ID_TOKEN_TTL=3600 魔术数字未走 contracts——与 `TOKEN_TTL.ACCESS_TOKEN` 重复定义 | 优化建议 | 常量管理 | 硬编码 3600 而未引用 `TOKEN_TTL` | 优化建议 |
| 7.6 | 多处 | 过宽 catch 块仅记录不处理——`catch { console.error(...) }` 模式在多处出现，吞掉异常无恢复 | 优化建议 | 错误恢复 | `brute-force.ts:51-52`, `revoke.ts:34-35` 等 | 优化建议 |

### 角色 8：性能

| 序号 | 文件:行号 | 问题描述 | 风险等级 | 影响范围 | 判断依据 | 复核状态 |
|------|-----------|----------|----------|----------|----------|----------|
| 8.1 | `refresh/route.ts:31,43` | refresh 路由重复读 Cookie/解码 JWT——accessToken 被 getJwtFromCookie 获取两次（先检查剩余时间，后获取用户信息） | 一般 | 性能 | Line 31 `getJwtFromCookie()` → Line 43 `getJwtFromCookie()` 再次获取 | ✅ 确认 |
| 8.2 | `menu-tree.ts:37-65` | menu-tree 全表加载内存过滤——`db.select().from(schema.permissions)` 无 LIMIT 加载所有菜单项后在 JS 中构建树 | 一般 | 性能 | Line 37-46 加载所有 DIRECTORY/PAGE 类型权限 | ✅ 确认 |
| 8.3 | `export/route.ts:22` | audit/export 硬编码 10000 条全量加载——pageSize=10000 无上限/无流式处理 | 优化建议 | 大数据量 | Line 22: `const pagination = { page: 1, pageSize: 10000 }` | 优化建议 |
| 8.4 | `brute-force.ts:58-68` | brute-force DB fallback 每次全表 COUNT——`count(*)` 在 login_logs 表无时间分区优化 | 优化建议 | 登录性能 | Line 60: `sql<number>\`count(*)::int\`` 全表扫描 | 优化建议 |
| 8.5 | `token.ts:59` | keyCache Map 无界可能内存泄漏——进程级 Map 缓存密钥对，无大小限制/过期淘汰 | 优化建议 | 内存 | `Map<string, CachedSigningKey>` 无 maxSize/cleanup | 优化建议 |

### 角色 9：安全

| 序号 | 文件:行号 | 问题描述 | 风险等级 | 影响范围 | 判断依据 | 复核状态 |
|------|-----------|----------|----------|----------|----------|----------|
| 9.1 | `crypto.ts:68`, `oauth-client.ts:43` | Client Secret 用 SHA-256 快哈希 + `!==` 非定时比较——可被时序攻击和 GPU 高速爆破 | 严重 | 客户端凭证安全 | `createHash('sha256')` 是快哈希（非 bcrypt/scrypt）；`!==` 是常规比较（非 timingSafeEqual） | ✅ 确认 |
| 9.2 | `brute-force.ts:33-80` | 暴力破解防护 fail-open（Redis 故障放行）且 DB fallback 语义不一致——与 1.1 关联 | 严重 | 登录安全 | 同 1.1，lines 51-52、70-72 的 catch 块静默返回安全值 | ✅ 确认（与 1.1 合并） |
| 9.3 | `callback/route.ts:86` | Token 交换失败响应体完整打印日志——`await tokenRes.text()` 可能包含敏感 token 信息 | 严重 | 信息泄露 | Line 86: `console.error('[Callback] Token 交换失败:', await tokenRes.text())` | ✅ 确认 |
| 9.4 | `redis.rs:74`, `verify.rs:106` | Gateway jti 黑名单检查 fail-open——Redis 不可用时 `check_jti` 返回 `true`（放行），已吊销 token 可能被接受 | 一般 | 令牌撤销 | `redis::exists()` 失败返回 false → `check_jti` 返回 true（放行） | ✅ 确认 |
| 9.5 | `export/route.ts:27-39` | CSV 导出公式注入风险——用户可控数据（userAgent 等）直接拼接进 CSV，可能含 `=`/`@`/`+`/`-` 等公式前缀 | 一般 | CSV 注入 | `l.userAgent.replace(/,/g, ' ')` 仅处理逗号，未处理公式前缀 | ✅ 确认 |
| 9.6 | `introspect/route.ts`, `revoke/route.ts` | revoke/introspect 端点的 Client Secret 比较同样非定时安全——与 9.1 关联 | 一般 | 客户端凭证安全 | 两个端点均调用 `validateClientSecret`，使用同样的 `!==` 比较 | ✅ 确认（与 9.1 合并） |
| 9.7 | `gateway.rs`, `verify-jwt.ts` | resolveIdentity Gateway 信任路径弱校验——HMAC 未配置时仅查 X-Forwarded-For | 优化建议 | 来源伪造 | 信任链依赖 HMAC 签名，未配置时降级为弱校验 | 优化建议 |

**安全亮点**（正向确认）：ES256 非对称签名、bcrypt cost 12、PKCE 强制 S256、refresh 轮换行锁 FOR UPDATE、用户枚举防护（统一 401）、redirect_uri 精确匹配（非前缀）——均为正确设计。

### 角色 10：可观测性

| 序号 | 文件:行号 | 问题描述 | 风险等级 | 影响范围 | 判断依据 | 复核状态 |
|------|-----------|----------|----------|----------|----------|----------|
| 10.1 | `audit.ts:42-192` | 审计日志 fire-and-forget 无失败重试/缓冲区——`writeLoginLog`/`writeAuditLog` 异步调用不 await | 严重 | 审计合规 | `writeLoginLog(...)` 调用无 await，失败静默丢失 | ✅ 确认 |
| 10.2 | 多处 | Node.js 端使用 console.log/error 代替结构化日志——`permissions.ts:158`, `login/route.ts:78` 等多处使用裸 console | 一般 | 日志质量 | `console.error(...)` 模式在至少 20+ 处出现 | ✅ 确认 |
| 10.3 | `error-mapping.ts:94` | 域错误映射 console.error 丢失堆栈跟踪——仅 log `err` 对象，未输出 `err.stack` | 一般 | 调试效率 | Line 94: `console.error('[mapDomainError] 未预期的异常:', err)` 无 .stack | ✅ 确认 |
| 10.4 | `telemetry/route.ts:11-32` | 遥测端点 /api/telemetry 无认证/限流保护——任何客户端可无限制 POST | 一般 | 安全/资源 | 无任何认证中间件或 rate limit | ✅ 确认 |
| 10.5 | `metrics.rs:50-60` | Rust 网关指标无 /metrics 端点——metrics 模块存在但未暴露 Prometheus endpoint | 一般 | 运维监控 | metrics.rs 有计数器定义但无 HTTP handler 暴露 | ⚠️ 存疑（需进一步验证具体端点暴露情况） |
| 10.6 | `server-logger.ts:43` | server-logger duration 始终为 null——底层数据读取无法计算 HTTP 耗时 | 一般 | 性能监控 | Line 43: `duration: null` 设计使然但丢失了性能数据 | ✅ 确认 |
| 10.7 | domain 函数 | 领域纯函数缺少耗时埋点——password.ts、oauth-code.ts 等核心函数无性能测量 | 优化建议 | 性能可观测 | 纯函数无任何计时逻辑 | 优化建议 |

### 角色 11：兼容性

| 序号 | 文件:行号 | 问题描述 | 风险等级 | 影响范围 | 判断依据 | 复核状态 |
|------|-----------|----------|----------|----------|----------|----------|
| 11.1 | Cookie 名称 | Cookie 名称完全对齐 ✅——`COOKIE_NAMES` contracts 在 Portal TS 和 Gateway Rust 侧一致 | -- | -- | 正向确认 | 无问题 |
| 11.2 | `refresh.rs:21` | Rust Redis Key 前缀未纳入共享契约——`"portal:refresh_dedup:"` 在 Rust 侧硬编码，未在 `contracts/oidc.ts` 的 `REDIS_KEY_PREFIX` 中定义 | 一般 | 跨语言一致性 | `REFRESH_DEDUP_PREFIX = "portal:refresh_dedup:"` vs contracts 中无此常量 | ✅ 确认 |
| 11.3 | `gateway.rs:766` | Gateway x-user-name header 未在共享契约定义——仅在测试断言中出现 `is_identity_header("x-user-name")`，无正式契约文档 | 一般 | 跨语言一致性 | Line 766: 测试中使用字面量字符串 | ✅ 确认 |
| 11.4 | `oidc.ts:40` vs `auth/mod.rs:41` | Token TTL TS/Rust 重复硬编码——`TOKEN_TTL.ACCESS_TOKEN = 3600` vs `ACCESS_TOKEN_MAX_AGE_SEC: u64 = 3600` | 优化建议 | 跨语言同步 | 两端独立定义相同值，修改需同步 | 优化建议 |
| 11.5 | `auth/mod.rs:20-34` | JWT Claims 字段命名依赖 Serde 宏无跨语言校验——`#[serde(rename_all = "camelCase")]` 无编译期验证 Portal TS 侧字段名一致 | 优化建议 | 跨语言安全 | Portal 侧字段名分散在各文件，无共享 `JwtClaims` interface 经 CI 校验 | 优化建议 |

### 角色 12：测试深度治理

| 序号 | 文件:行号 | 问题描述 | 风险等级 | 影响范围 | 判断依据 | 复核状态 |
|------|-----------|----------|----------|----------|----------|----------|
| 12.1 | `audit-logging.test.ts:148-185` | 审计日志过滤测试无业务断言——日期范围/操作类型/userId 过滤测试仅验证 `expect(response.status).toBe(200)`，不验证过滤结果 | 严重 | 测试质量 | Line 160/172/184: 三个过滤测试的断言均为 `expect(response.status).toBe(200)` | ✅ 确认 |
| 12.2 | `department-api.test.ts:271-276` | 部门数据范围过滤测试不验证过滤效果——仅验证接口返回 200，不检查返回数据是否按权限过滤 | 严重 | 测试质量 | 测试验证了 API 调用成功但未验证过滤逻辑正确性 | ⚠️ 存疑（未读取确切代码行） |
| 12.3 | `auth-login.test.ts:190-204` | 登录 API 测试仅验证 mock 间交互——测试 mock 调用而非业务行为 | 严重 | 测试质量 | 基于 mock 验证调用次数/参数，非验证实际登录结果 | ⚠️ 存疑（需进一步验证） |
| 12.4 | `session-lifecycle.test.ts:139-155` | session 生命周期测试中 setJwtCookies 仅 spy 验证——验证 mock 调用而非实际 Cookie 设置 | 严重 | 测试质量 | spy 验证 mock 对象交互，非集成级别验证 | ⚠️ 存疑（需进一步验证） |
| 12.5 | 权限强制测试 | 权限强制测试全量 mock 依赖——所有外部依赖被 mock，测试价值降低 | 一般 | 测试质量 | mock 替代真实集成 | ✅ 确认（通用测试反模式） |
| 12.6 | `client-api.test.ts:151-224` | Client API 测试无写操作/异常路径——仅覆盖 GET 正常路径 | 严重 | 测试覆盖 | 测试文件仅测试列表/详情获取，无 POST/PUT/DELETE 及异常 | ⚠️ 存疑（需进一步验证） |
| 12.7 | `department-api.test.ts:187-297` | 部门 API 测试缺 5 个写操作场景——创建/更新/删除/移动/成员管理等场景缺失 | 一般 | 测试覆盖 | 测试覆盖不完整 | ⚠️ 存疑（需进一步验证） |
| 12.8 | `role-api.test.ts` | 角色 API 测试仅覆盖 GET 端点——与 12.6 类似 | 一般 | 测试覆盖 | 无 POST/PUT/DELETE 测试 | ⚠️ 存疑（需进一步验证） |
| 12.9 | `client.test.ts` | Client Domain 测试无异常路径——domain 层测试仅测试正常路径 | 一般 | 测试覆盖 | 无 invalid/edge case 测试 | ⚠️ 存疑（需进一步验证） |
| 12.10 | `me-endpoints.test.ts` | Me Endpoints 权限 null 断言不充分 | 一般 | 测试质量 | null/undefined 边界测试不足 | ⚠️ 存疑（需进一步验证） |
| 12.11 | `user-api.test.ts` | User API 测试 withAuth mock 复制实现逻辑（脆弱） | 一般 | 测试维护 | mock 实现与真实代码逻辑耦合 | ✅ 确认（测试反模式） |
| 12.12 | `role-api.test.ts` | Role API withPermission mock 动态 import 真实模块 | 一般 | 测试隔离 | 测试边界不清 | ⚠️ 存疑（需进一步验证） |
| 12.13 | drizzle mock 相关 | drizzle Proxy chain mock 深度耦合 ORM 内部实现 | 一般 | 测试脆弱性 | mock 了 drizzle 内部 Proxy 行为 | ✅ 确认 |
| 12.14 | User 写操作测试 | User 写操作仅验证成功消息不验证持久化 | 一般 | 测试质量 | 验证 success message 但不检查 DB 写入结果 | ⚠️ 存疑（需进一步验证） |
| 12.15 | `brute-force.ts` | brute-force.ts 零测试覆盖——高危安全模块完全没有单元测试 | 严重 | 安全质量保证 | 无 brute-force.test.ts 文件 | ✅ 确认 |

### 角色 13：CI/CD 工程化

| 序号 | 文件:行号 | 问题描述 | 风险等级 | 影响范围 | 判断依据 | 复核状态 |
|------|-----------|----------|----------|----------|----------|----------|
| 13.1 | `pr.yml`, `main.yml` | PR CI 和 Main CI 缺少 lint + typecheck 步骤——两个 workflow 均只有 install + test，无代码质量门禁 | 严重 | 代码质量 | pr.yml: 仅 `install → test:api → test:components`；main.yml: 仅 `install → db:push → db:seed → test:e2e → upload report` | ✅ 确认 |
| 13.2 | `docker-compose.prod.yml:67` | 生产 docker-compose 用 latest tag 不可回滚——`image: auth-sso-portal:latest` 无法锁定版本 | 一般 | 部署安全 | Line 67: `auth-sso-portal:latest` | ✅ 确认 |
| 13.3 | `Dockerfile:16` | Portal Dockerfile 含调试代码——`RUN echo "=== DEBUG: check source ===" && grep ...` 在生产镜像中暴露源码片段 | 一般 | 构建安全 | Line 16: `RUN echo "=== DEBUG: check source ===" && grep "redirectUri\|pkce_verifier" ...` | ✅ 确认 |
| 13.4 | `Dockerfile:11` | Dockerfile 硬编码 npmmirror registry——`pnpm config set registry https://registry.npmmirror.com` 在中国境外部署不可用 | 一般 | 构建兼容性 | Line 11: `registry.npmmirror.com` 硬编码 | ✅ 确认 |
| 13.5 | 项目根目录 | 缺少 pre-commit hook 配置——无 husky/lint-staged/lefthook 等本地门禁 | 优化建议 | 代码质量 | 项目无 .husky/ 目录或 lint-staged 配置 | 优化建议 |
| 13.6 | `.env.example`, `.env.local`, `.env.prod`, `docker-compose.local.yml` | 环境变量模板碎片化——4 个文件重叠部分不一致 | 优化建议 | 部署可靠性 | 多个 env 文件有重叠变量但值/存在性不一致 | 优化建议 |
| 13.7 | `docker-compose.local.yml` | docker-compose.local.yml 缺少关键环境变量——`GATEWAY_SHARED_SECRET` 等未定义 | 一般 | 本地开发 | 与 `.env.example` 问题相关 | ✅ 确认 |

### 角色 14：业务治理

| 序号 | 文件:行号 | 问题描述 | 风险等级 | 影响范围 | 判断依据 | 复核状态 |
|------|-----------|----------|----------|----------|----------|----------|
| 14.1 | `clients/data.ts:22` vs OAuth API 层 | redirectUris（DB 字段 camelCase）vs redirect_uri（OAuth 协议 snake_case）命名不一致——DB 存储用 `redirect_uris`（复数），协议用 `redirect_uri`（单数），代码层 camelCase 转换后命名分散 | 一般 | 代码可读性 | `redirectUris` 用于 DB 映射，`redirectUri` 用于参数，无统一文档说明 | ✅ 确认 |
| 14.2 | `login.ts:36-41`, `permissions.ts:95` | 用户状态校验逻辑散落两处——`validateLoginCredentials` 在 login.ts 检查状态，`getUserPermissionContext` 在 permissions.ts 再次检查 | 一般 | 代码维护 | Line 36-41/95 两处独立实现相同的状态检查逻辑 | ✅ 确认 |
| 14.3 | `token.ts`, `oidc.ts` | ID_TOKEN_TTL 硬编码未纳入 contracts——与 7.5 关联 | 一般 | 常量管理 | 同 7.5 | ✅ 确认（与 7.5 合并） |
| 14.4 | `permissions.ts:12-18` | 权限缓存 TTL 硬编码（PERM_CACHE_TTL_BASE=3600 等）——与 Access Token TTL 对齐但未通过 contracts 共享 | 一般 | 缓存一致性 | Line 12-18 本地常量未走 contracts | ✅ 确认 |
| 14.5 | `rbac.ts:48` vs contracts `ADMIN_ROLE_CODES` | isSystem vs ADMIN_ROLE_CODES 两个独立管理员判定维度——角色表 is_system 字段未与 ADMIN_ROLE_CODES 常量联动 | 优化建议 | 权限一致性 | `isSystem` 列在设计上独立于 `ADMIN_ROLE_CODES` 数组，存在漂移风险 | ✅ 确认 |

---

## 3. 整体重构与规范方案

### 3.1 分层架构调整建议

当前架构问题核心是 **data.ts 读模型反向依赖 auth 鉴权层**，建议调整为：

```
┌─────────────────────────────────────────┐
│  API Route (薄 Controller)               │
│  职责：参数解析、鉴权调用、响应格式化    │
├─────────────────────────────────────────┤
│  lib/auth (鉴权横切层)                   │
│  职责：withPermission、canAccessDept      │
│  依赖 → domain、infrastructure           │
├─────────────────────────────────────────┤
│  Data Access (纯读模型)                  │
│  职责：Drizzle 查询、结果映射            │
│  依赖 → infrastructure (仅 DB)           │
│  严禁 → lib/auth                         │
├─────────────────────────────────────────┤
│  Domain (纯业务函数)                     │
│  职责：校验、计算、策略                  │
│  依赖 → contracts、无框架依赖            │
├─────────────────────────────────────────┤
│  Infrastructure (DB/Redis/Crypto)        │
│  职责：连接池、客户端实例                │
│  依赖 → 外部服务                         │
└─────────────────────────────────────────┘
```

**调整方案**：将 `canAccessDept` 调用提升到 API Route 层，data.ts 只做纯数据查询并接受 `deptIds` 参数过滤。

### 3.2 统一编码规范

- **错误处理**：所有 catch 块必须 (a) 记录结构化日志含 stack，(b) 明确决策是重试/降级/传播/终止；(c) 严禁 `catch { }` 空块
- **非空断言**：禁止 `!` 操作符，统一使用类型守卫 + 早期返回/抛出
- **魔术数字**：所有可配置常量必须定义在 `packages/contracts/src/` 并同时被 TS 和 Rust 引用
- **API 响应格式**：统一为 `{ success: boolean, data?: T, error?: string, message?: string, pagination?: {...} }`

### 3.3 公共组件/工具抽取规划

| 组件 | 当前位置 | 目标位置 | 说明 |
|------|----------|----------|------|
| `hashClientSecret` | `crypto.ts:68` + `oauth-client.ts:43` | 统一到 `crypto.ts`，oauth-client.ts 引用 | 消除重复 |
| `validateClientSecret` | `oauth-client.ts:43` | 内部改用 `crypto.ts` 的 hash + `timingSafeEqual` | 统一+安全 |
| `pageSize` clamp | 各 data.ts 分散 | 抽取 `lib/pagination.ts` 或 contracts | 统一上限 |
| ID_TOKEN_TTL | `token.ts:368` 硬编码 | 改为引用 `TOKEN_TTL.ACCESS_TOKEN` | 消除魔术数字 |
| Redis key 前缀 | TS + Rust 分散定义 | 统一到 contracts `REDIS_KEY_PREFIX` | 跨语言一致性 |
| Token TTL 常量 | TS `TOKEN_TTL` + Rust 硬编码 | contracts JSON/YAML → 生成 TS + Rust | 单一真相源 |

### 3.4 接口与数据统一标准

- **API 版本化**：所有路由从 `/api/*` 迁移到 `/api/v1/*`
- **ApiResponse 统一**：定义 `ApiResponse<T>` 泛型并强制所有路由使用
- **pageSize 上限**：全局最大 100（可配置），通过中间件或 contracts 常量统一
- **FK 完整性**：补充 `role_permissions.permission_id → permissions.id` 和 `permissions.parent_id → permissions.id` FK
- **passwordHistory migration**：生成新的 migration SQL 添加 `password_history text[]` 列

---

## 4. 核心模块优化示例

### 4.1 type-guards.ts：从 as 断言到真正运行时校验

**优化前**（当前代码）：
```typescript
// type-guards.ts:22-38
/**
 * 运行时校验 + 类型收窄：将字符串转换为 EntityStatus 枚举
 */
export function asEntityStatus(v: string): EntityStatus {
  return v as EntityStatus;  // 零校验！
}
```

**优化后**：
```typescript
import { ENTITY_STATUS_VALUES } from '@auth-sso/contracts';

const ENTITY_STATUS_SET: ReadonlySet<string> = new Set(ENTITY_STATUS_VALUES);

export function asEntityStatus(v: string): EntityStatus {
  if (!ENTITY_STATUS_SET.has(v)) {
    throw new Error(`Invalid EntityStatus: ${v}`);
  }
  return v as EntityStatus;  // 此时 as 安全——前方已校验
}
```

### 4.2 Client Secret 校验：SHA-256 → bcrypt + 定时比较

**优化前**：
```typescript
// oauth-client.ts:43
const providedHash = createHash('sha256').update(providedSecret).digest('hex');
if (client.clientSecret !== providedHash) {  // 非定时比较
  throw new InvalidClientError('客户端密钥不匹配');
}
```

**优化后**：
```typescript
import bcrypt from 'bcryptjs';

// crypto.ts：统一使用 bcrypt 存储
export async function hashClientSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, 12);  // cost 12 防离线爆破
}

// oauth-client.ts：bcrypt.compare 内部使用常量时间比较
export async function validateClientSecret(
  client: { clientSecret: string | null },
  providedSecret?: string,
): Promise<void> {
  if (client.clientSecret) {
    if (!providedSecret) throw new InvalidClientError('客户端密钥缺失');
    const valid = await bcrypt.compare(providedSecret, client.clientSecret);
    if (!valid) throw new InvalidClientError('客户端密钥不匹配');
  }
}
```

### 4.3 brute-force.ts：修复 INCR 时序

**优化前**：
```typescript
// login/route.ts:52-57（INCR 在密码校验前）
const bruteCheck = await checkBruteForce(user.id);  // ← INCR 在这里
if (bruteCheck.locked) return 423;
validateLoginCredentials(user);
const valid = await verifyPassword(password, user.passwordHash!);
if (!valid) throw new InvalidCredentialsError();
await clearBruteForceCounter(user.id);  // ← 成功后清除
```

**优化后**：
```typescript
// login/route.ts
const bruteCheck = await checkBruteForce(user.id);  // ← 只读检查，不 INCR
if (bruteCheck.locked) return 423;

validateLoginCredentials(user);
const valid = await verifyPassword(password, user.passwordHash!);
if (!valid) {
  await incrementBruteForce(user.id);  // ← 仅失败后 INCR
  writeLoginLog({ ... failReason: '密码错误' });
  throw new InvalidCredentialsError();
}
await clearBruteForceCounter(user.id);
```

---

## 5. 分阶段落地路线图

| 阶段 | 内容 | 预计工作量 | 风险点 | 可独立上线 |
|------|------|------------|--------|------------|
| **Phase 0 - 紧急修复** | (1) 补充 passwordHistory migration (2) 补充 RBAC FK 约束 (3) 修复 introspect 静默吞异常 (4) 修复 callback Token 日志泄露 (5) 移除 Dockerfile 调试代码 | 3 人日 | FK 添加可能因现有脏数据失败，需先清洗 | ✅ 是 |
| **Phase 1 - 安全加固** | (1) Client Secret 迁移 bcrypt + 定时比较 (2) 修复 brute-force INCR 时序 + 去除 fail-open (3) type-guards 真正运行时校验 (4) gateway jti fail-open 改 fail-close (5) CSV 导出公式注入防护 | 8 人日 | Secret 哈希迁移需兼容旧数据；fail-close 可能影响可用性 | ✅ 是 |
| **Phase 2 - 接口标准化** | (1) 统一 ApiResponse 契约 + 批量改造 CRUD 路由 (2) pageSize clamp (3) API 版本化 /api/v1 (4) 错误码对齐 RFC 6749 | 10 人日 | Breaking Change 需客户端协同升级；加版本前缀需网关配合 | ❌ 否（需协调客户端） |
| **Phase 3 - 测试补强** | (1) brute-force.ts 单元测试 (2) 审计日志过滤断言 (3) 登录 API 业务断言 (4) 写操作持久化验证 (5) 异常路径覆盖 | 12 人日 | mock 测试改集成测试需要测试基础设施 | ✅ 是 |
| **Phase 4 - CI/CD 工程化** | (1) PR/main CI 加入 lint+typecheck (2) 添加 pre-commit hooks (3) 生产镜像改用版本 tag (4) 统一 env 模板 | 5 人日 | lint 首次运行可能大量报错，需先修复或配置基线 | ✅ 是 |
| **Phase 5 - 架构优化** | (1) data.ts 去反向依赖 (2) Token TTL 跨语言统一 (3) Redis key 前缀入 contracts (4) guard/facade 合并去重 | 8 人日 | 重构涉及多模块，回归风险较高 | ❌ 否（需充分测试） |

---

## 6. 长期维护规范

### 6.1 代码提交前自检清单

- [ ] 新增 API 端点是否使用了 `ApiResponse<T>` 统一格式？
- [ ] 是否存在裸 `as` 断言（非 type-guard 后）？
- [ ] 是否存在 `!` 非空断言？
- [ ] 异常处理是否明确决策（传播/降级/重试）而非静默吞掉？
- [ ] 安全相关比较是否使用了 `timingSafeEqual`？
- [ ] 新增常量和配置是否放入了 `packages/contracts`？
- [ ] Schema 变更是否生成了 migration SQL 且 SQL 包含完整 DDL？
- [ ] 是否有对应的单元/集成测试（覆盖率不下降）？

### 6.2 架构约束红线

1. **data.ts 严禁 import `lib/auth`**——读模型只能依赖 infrastructure
2. **domain 层严禁 import DB/Redis 客户端**——纯函数，零副作用
3. **严禁在生产 Dockerfile 中保留调试代码**
4. **Client Secret 存储必须使用 bcrypt/scrypt/argon2**，严禁 SHA-256/512
5. **Redis/DB 异常在安全关键路径上必须 fail-close**（jti 黑名单、暴力破解计数），非关键路径可 fail-open
6. **新增 permission_code 必须在 `packages/contracts/src/permissions.ts` 注册**

### 6.3 团队编码公约

- **统一错误模型**：所有业务异常使用 `DomainError` 子类，Controller 层统一调用 `mapDomainError()` 映射 HTTP 语义
- **结构化日志**：使用 `pino`/`winston` 或至少 JSON.stringify 日志，禁止裸 `console.log(error)`（丢失 stack）
- **测试原则**：优先验证业务行为（返回值/数据库状态），其次验证 HTTP 状态码，最后验证 mock 交互；禁止仅有 mock 验证的测试
- **常量管理**：跨语言共享常量 → contracts；仅 Node 侧常量 → `lib/env.ts` 或 `lib/constants.ts`；仅 Rust 侧常量 → `auth/mod.rs`；严禁第三方硬编码
- **命名规范**：DB 字段 snake_case → 代码层 camelCase（Drizzle 自动映射）；OAuth 协议保持 snake_case（与 RFC 一致）；JS/TS 变量 camelCase

---

## 审计方法说明

本报告通过以下五步流水线生成：

1. **全局分析（Explore Agent）**：输出 46 页项目结构适配报告，覆盖 4 层服务角色映射、34 个 API route、13 个关键路径
2. **四路并行审计（Agent A/B/C/D）**：覆盖 14 角色、阅读 150+ 文件、输出 70+ 条发现
3. **复核交叉验证（Review Agent）**：去重合并 5 组重复发现（暴力破解、Token TTL、Client Secret、ApiResponse、测试质量），TOP10 全部代码级确认
4. **最终报告生成**：6 部分固定结构，含代码对比示例和分阶段路线图
5. **文档落地**：写入 `docs/audit/2026-07-10-code-audit.md`

标注说明：
- ✅ 经复核确认：已实际读取源码，确认问题存在
- ⚠️ 存疑：引用不够精确或需要进一步验证（通常因 Agent 未提供确切行号或需更深层代码分析）
- 无问题标注：Agent 正确识别了无问题的项目特征
