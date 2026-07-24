# 代码全维度审计报告

> **审计日期**：2026-07-23
> **项目**：Auth-SSO
> **审计范围**：`apps/`、`packages/`（41,644 行，含 Portal、Gateway、Demo App、contracts、config）
> **综合评级**：C
> **严重问题数**：12 个 ｜ **一般问题数**：8 个 ｜ **优化建议**：2 个

## 目录

- [全局诊断](#1-全局诊断)
- [分角色问题清单](#2-分角色问题清单)
- [重构与规范方案](#3-重构与规范方案)
- [核心优化示例](#4-核心优化示例)
- [分阶段落地路线图](#5-分阶段落地路线图)
- [长期维护规范](#6-长期维护规范)

## 1. 全局诊断

> **2026-07-24 整治勘正：** 本报告的“RT 未绑定 Client / revoke 跨 Client”条目与随后确认的 ADR-006 用户级全局会话模型冲突，因此不作为缺陷处理。Gateway 不校验 `aud` 亦为 ADR-006 的明确决策。其余已实施整改见 `docs/solution/2026-07-24-adr-aligned-audit-remediation.md`。

### TOP 5（经二次代码复核）

1. **授权码可并发重放**：校验 `used=false` 后才进行无条件更新；两个请求都可完成校验和签发。见 `apps/portal/src/app/api/auth/oauth2/token/route.ts:64-93`。
2. **Portal 权限码前缀失配**：共享契约/数据库权限为 `portal:*`，多数路由仍要求旧的 `user:list` 等字符串，非管理员用户将被错误拒绝。见 `packages/contracts/src/permissions.ts:6-22`、`apps/portal/src/app/api/users/route.ts:15`。
3. **Gateway Discovery 缺 `issuer` 时仍接受快照**：会构造无 issuer 绑定的验证器。见 `apps/gateway/src/jwks.rs:219-237`。`aud` 不校验是 ADR-006 确立的体系级 audience 决策，不作为问题。
4. **迁移链无法从空库执行**：`0002` 与 `0003` 重复创建同名索引，后者不具备幂等性。见 `apps/portal/drizzle/0002_add_login_logs_composite_index.sql:4`、`0003_fixed_prism.sql:2`。
5. **OAuth/OIDC 客户端与 scope 隔离不足**：Refresh Token 未绑定 client；revoke 不校验 token 归属；请求 scope 未受 client allow-list 约束；UserInfo 无条件泄露 profile/email。见 `apps/portal/src/app/api/auth/oauth2/{token,revoke,userinfo,authorize}/route.ts`。

### 分维度评级

| 维度 | 评级 | 结论 |
|---|:---:|---|
| 认证与授权安全 | D | JWT issuer 边界、OAuth code/scope 的核心约束不完整；Gateway 不校验 audience 是既定 ADR 决策。 |
| API / 契约一致性 | D | 权限码与 OIDC issuer、scope、UserInfo 契约存在实质偏差。 |
| 数据迁移与交付 | D | 空库迁移失败，CI 使用 `db:push` 未覆盖生产升级路径。 |
| 架构与可维护性 | B | 分层基础较好；时间模型、配置边界和少量模块职责仍有偏差。 |
| 测试与质量门禁 | C | Vitest 已通过，但关键真实 OAuth/迁移/E2E 链路缺少防回归验证。 |
| 可观测性与运维 | C | 有结构化日志/健康检查，缺少可抓取指标、告警和分区任务调度。 |

## 2. 分角色问题清单

### 角色 1：需求工程

- ✅ `apps/portal/src/app/api/auth/oauth2/userinfo/route.ts:39-46` — **严重** — 不论 scope 都返回 name/email/picture，违反 `docs/spec/API.md:257` 的最小披露规则。
- ✅ `apps/portal/src/app/api/auth/oauth2/token/route.ts:97` — **一般** — `includes('openid')` 不是 scope token 匹配，`notopenid` 会误触发 ID Token。

### 角色 2：流程标准化

- ✅ `apps/portal/drizzle/0002_add_login_logs_composite_index.sql:4`、`0003_fixed_prism.sql:2` — **严重** — 迁移顺序不可在空库运行；现有 CI 未捕获。
- ✅ `docs/spec/DATABASE.md:5.3`、`apps/portal/drizzle/0000_swift_rumiko_fujikawa.sql:160-173` — **一般** — 文档声明 access_logs 分区，实际父表为普通表。

### 角色 3：系统架构

- ✅ `apps/portal/src/domain/{user,role,department,permission,client}/*.ts` — **一般** — 领域层采用 `Date` 和 `new Date()`，偏离架构约束 R9 的 `Temporal.Instant` 边界模型。
- ✅ `apps/portal/src/domain/auth/password.ts:26-35` — **一般** — 领域模块直接读取 `process.env`，绕过 config 的单一 Zod 配置入口。

### 角色 4：数据建模

- ✅ `apps/portal/src/db/schema/auth.ts:90-109` — **严重** — Refresh Token 未保存 client 身份，无法约束 token substitution/跨 client 轮换。
- ✅ `apps/portal/src/db/schema/{users,rbac}.ts:65-71,93-100` — **一般** — 规格写复合主键，实际是唯一索引；需统一文档或模型。

### 角色 5：API 标准化

- ✅ `apps/portal/src/app/api/users/route.ts:15`（及同类路由/Action）— **严重** — 要求 `user:list`，而 `packages/contracts/src/permissions.ts:6-22` 的唯一真相为 `portal:user:list`。
- ✅ `apps/portal/src/app/api/auth/oauth2/authorize/route.ts:37-46,202-217` — **严重** — scope 仅为任意字符串，未验证为已注册 client 的允许 scopes 子集。
- ✅ `apps/portal/src/app/.well-known/openid-configuration/route.ts:22-32`、`apps/portal/src/lib/auth/token.ts:192-199` — **一般** — Discovery issuer 与 ID Token issuer 不一致。

### 角色 6：全链路实现

- ✅ `apps/portal/src/app/api/auth/oauth2/token/route.ts:64-93` — **严重** — authorization code 非原子消费，可并发重放。
- ✅ `apps/portal/src/app/api/auth/oauth2/revoke/route.ts:51-74` — **严重** — 只认证调用 client，不校验 token 属主；任意合法 client 可对其它 client token 造成撤销型 DoS。
- ✅ `apps/portal/src/app/api/telemetry/route.ts:15-23,50-61` — **一般** — 受保护请求仍信任 body 中的 `userId` 作为审计主体。

### 角色 7：Clean Code

- ✅ `apps/portal/src/lib/auth/token.ts`、`apps/gateway/src/gateway.rs` — **优化建议** — 高内聚安全流程文件较长；在 P0 验证后按 sign/keys/rotate/revoke 与 gateway OAuth 边界拆分，避免与安全修复混做。

### 角色 8：性能与韧性

- ✅ `apps/portal/src/lib/permissions.ts:212-218,243-262`、`apps/portal/src/lib/session/revoke.ts:126-134` — **一般** — 对任意长度 userIds 直接并发 Redis/DB 操作，大角色变更会冲击连接池。
- ✅ `apps/portal/src/infrastructure/redis/index.ts:60-65` — **一般** — 未显式限制连接/命令超时与 offline queue，Redis 断连可拖慢鉴权回退。

### 角色 9：应用安全

- ✅ `apps/gateway/src/jwks.rs:219-237` — **严重** — Discovery 缺 issuer 仅告警，随后构造无 issuer 验证的快照。
- ✅ `packages/config/src/env.ts:29-33`、`apps/gateway/src/config.rs:20,43,196-198` — **一般** — 生产环境可缺少 Gateway HMAC shared secret，未 fail-fast。

### 角色 10：可观测性

- ✅ `apps/gateway/src/metrics.rs:97-112`、`apps/portal/src/app/api/health/route.ts:54-67` — **一般** — 仅日志快照/依赖探测，无可抓取 metrics 与告警闭环。

### 角色 11：兼容性

- ✅ `apps/portal/src/lib/session/jwt.ts:30-33` — **优化建议** — 兼容导出具备弃用日期，保留到期清理任务即可；未发现无期限兼容分支。

### 角色 12：质量管控

- ✅ `apps/portal/__tests__/api/permission-enforcement.test.ts:253-256,482-510` — **一般** — 仅验证 wrapper 传入 `portal:*`，未覆盖真实路由的旧权限字符串，未能拦截角色 5 的回归。
- ✅ `apps/portal/drizzle/*`、`.github/workflows/{main,pr}.yml:65-75` — **严重** — CI 执行 `db:push` 而非空库 `db:migrate`，迁移破损没有测试保护。
- ✅ `tests/e2e/` 缺失且仓库未发现 Playwright `*.spec.ts`/配置 — **一般** — `test:e2e` 脚本未提供核心登录→授权→回调旅程的有效证据。

### 角色 13：CI/CD 工程

- ✅ `.github/workflows/{main,pr}.yml:65-75` — **严重** — `db:push` 绕过 migration history，不能证明可升级部署。
- ✅ `apps/gateway/Dockerfile:27` — **一般** — `alpine:latest` 使构建不可复现；应固定版本/digest。
- ✅ `apps/portal/scripts/maintain-access-log-partitions.ts:53-57`、`apps/portal/package.json:6-20` — **严重** — 脚本会对非分区表创建分区，且没有被部署调度。

### 角色 14：业务治理

- ✅ `apps/portal/src/app/api/auth/oauth2/userinfo/route.ts:33-46` — **严重** — OIDC claim 释放规则未集中为 scope policy，业务最小授权无法治理。

## 3. 重构与规范方案

1. 以 `@auth-sso/contracts` 权限常量替换全部 Controller/Action 的字面量；新增静态扫描禁止 `permissions: ['...']` 字面量。
2. 建立 OAuth 授权凭据数据模型：authorization code 用条件更新原子领取；Refresh Token、access-token 记录保存 `client_id`；scope 解析为集合并在 authorize 时按 client allow-list 验证。
3. Gateway 保持 ADR-006 的体系级 `aud` 不校验；Discovery 异常时保留最后有效 JWKS 快照，且绝不降级 issuer 验证条件。
4. 将迁移作为唯一生产 schema 演进通道。修复历史冲突须评估已部署数据库，再添加安全迁移；CI 空库只运行 `db:migrate`。
5. 分区表改造以演练迁移、回填/切换、定时任务和失败告警为一个可回滚交付单元。

## 4. 核心优化示例

### A. 授权码原子领取

现状（`token/route.ts:64-80`）：先读并验证、后无条件 `UPDATE`，两个并发请求都可能签发 token。

```ts
const [authCode] = await db
  .update(schema.authorizationCodes)
  .set({ used: true })
  .where(and(
    eq(schema.authorizationCodes.code, code),
    eq(schema.authorizationCodes.clientId, client.clientId),
    eq(schema.authorizationCodes.used, false),
    gt(schema.authorizationCodes.expiresAt, new Date()),
  ))
  .returning();
if (!authCode) throw new InvalidGrantError('授权码无效、已使用或已过期');
```

先由条件更新“领取”授权码，再做 PKCE/签发；实际实现应把 PKCE 所需字段和领取操作放入受控事务，且增加并发兑换只成功一次的集成测试。

### B. 权限码仅从契约导入

现状（`api/users/route.ts:15`）：

```ts
withPermission({ permissions: ['user:list'] }, handler)
```

目标：

```ts
import { PORTAL_PERMISSION_CODES } from '@auth-sso/contracts';
withPermission({ permissions: [PORTAL_PERMISSION_CODES.USER_LIST] }, handler)
```

消除运行时字符串失配，并让重命名通过 TypeScript 编译失败显性暴露。

## 5. 分阶段落地路线图

| 阶段 | 内容 | 工作量 | 风险点 | 可独立上线 |
|---|---|:---:|---|:---:|
| P0 | 修复 Gateway issuer、权限码、authorization code 原子消费 | 2–4 天 | 现有 token/权限兼容 | ✅ |
| P0 | scope allow-list、UserInfo 最小披露与全局用户级 RT 语义回归 | 3–5 天 | 需迁移和 RP 回归 | ✅ |
| P0 | 修复迁移链并加空库 migrate CI | 1–2 天 | 已部署环境 migration history | ✅ |
| P1 | access_logs 分区改造、定时调度、保留期告警 | 3–5 天 | 大表迁移/回填 | ⚠️ |
| P1 | Redis/Gateway secret fail-fast、超时和批量有界并发 | 1–2 天 | 运行配置 | ✅ |
| P2 | metrics/告警、镜像 digest 固定、领域 Temporal/config 边界 | 3–5 天 | 可观测性设施与跨层重构 | ✅ |
| P3 | Token/Gateway 文件拆分及测试结构整理 | 3–5 天 | 与安全修复混合会扩大风险 | ⚠️ |

## 6. 长期维护规范

- 每次 OAuth、JWT、Gateway 改动必须覆盖：issuer、code 并发兑换、scope 最小披露与 RT 用户级全局会话语义；Gateway audience 不校验须有回归测试。
- 合并前必须在空 PostgreSQL 上执行 `db:migrate`，不以 `db:push` 代替；生产迁移必须有回滚/演练记录。
- 所有 Portal 权限要求必须引用 contracts 常量，禁止字面权限码。
- Gateway shared secret 生产环境一律 fail-fast；Discovery 刷新不得降低已有 issuer 校验强度，audience 保持 ADR-006 的体系级不校验。
- 每个可运行维护脚本必须被部署调度并有成功/失败指标；日志不是告警系统的替代品。
- 发布前执行 `pnpm test`、`pnpm lint`、`pnpm typecheck`、Gateway `cargo test`/clippy/fmt，并保留核心 E2E 旅程证据。
