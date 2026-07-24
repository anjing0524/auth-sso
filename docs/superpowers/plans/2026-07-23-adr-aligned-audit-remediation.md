# ADR 对齐的审计整治实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不违背 ADR-001~009 的前提下，修复 OAuth、权限、Gateway issuer、数据库基线、运维和测试问题。

**Architecture:** AT/RT 继续是 ADR-006 定义的用户级会话令牌，aud 固定 `auth-sso`，Gateway 不验 aud。OAuth client 仅约束授权码、回调地址、调用方凭据和可申请 scope；授权码原子消费，AT 携带 scope 用于 UserInfo 投影。数据库使用唯一干净基线，旧迁移不兼容。

**Tech Stack:** Next.js 16、TypeScript、Zod、Drizzle/PostgreSQL 16、Vitest 4、Rust 1.93/Pingora。

## Global Constraints

- 遵循 ADR-006：JWT 最小化、RT 用户级、`iss`/`aud` 为 `auth-sso`，Gateway `validate_aud = false`。
- 遵循 ADR-007：Gateway 不读取/分发权限，子应用自取权限。
- 遵循 ADR-008：所有 Portal 权限码只从 `@auth-sso/contracts` 常量导入。
- 旧数据库可重建，删除旧 drizzle 历史；不实现在线迁移。
- 每个行为改动先加失败测试，确认 RED 后才写实现。

---

### Task 1: 固化 OAuth scope 与授权码原子领取

**Files:**
- Create: `apps/portal/__tests__/api/oauth-security.test.ts`
- Modify: `apps/portal/src/domain/auth/oauth-authorize.ts`
- Modify: `apps/portal/src/app/api/auth/oauth2/authorize/route.ts`
- Modify: `apps/portal/src/app/api/auth/oauth2/token/route.ts`
- Modify: `apps/portal/src/lib/auth/token.ts`

- [ ] 写失败测试：未注册 scope 返回 OAuth `invalid_scope`；`notopenid` 不签发 ID Token；两个并发 token 请求只有一个返回 200，另一个 `invalid_grant`。
- [ ] 运行 `pnpm exec vitest run --project @auth-sso/portal apps/portal/__tests__/api/oauth-security.test.ts`，确认失败原因是当前任意 scope/非原子领取。
- [ ] 在 domain 新增纯函数 `parseScopes(input: string): string[]` 与 `validateRequestedScopes(requested, allowed)`：按空白分词、去重、拒绝空 token 和非 allow-list 值。
- [ ] authorize 在写 code 前校验 client.scopes；token 用条件 update（`code`、`clientId`、`used=false`、未过期）领取并只对精确 `openid` 签 ID Token；AT/RT 维持无 clientId、aud `auth-sso`。
- [ ] 重跑该文件并扩展 refresh-token 断言，确认 RT 仍不按 client 查询。

### Task 2: UserInfo、issuer 与 telemetry 主体

**Files:**
- Modify: `apps/portal/src/app/api/auth/oauth2/userinfo/route.ts`
- Modify: `apps/portal/src/app/.well-known/openid-configuration/route.ts`
- Modify: `apps/portal/src/lib/auth/token.ts`
- Modify: `apps/portal/src/app/api/telemetry/route.ts`
- Modify: `apps/portal/__tests__/api/oauth-security.test.ts`

- [ ] 写失败测试：`openid` 只返回 sub，`profile` 和 `email` 分别增量返回 claims；discovery issuer 与 ID Token issuer 相等；telemetry 忽略 body.userId。
- [ ] 运行测试确认失败。
- [ ] 使用 token 的 `scope` claim 做 UserInfo 投影；Discovery 和 token 均使用 ADR-006 固定 issuer `auth-sso`；telemetry 只采用 `withPermission` 回传 userId。
- [ ] 重跑测试，且保留 ADR-006 的 `aud=auth-sso` 断言。

### Task 3: Contracts 权限码全量收敛

**Files:**
- Modify: `apps/portal/src/app/**/*.ts`
- Modify: `apps/portal/__tests__/api/permission-enforcement.test.ts`

- [ ] 用 `rg -n "permissions: \['" apps/portal/src` 建立所有旧字面量清单，并为非管理员真实路由成功鉴权写失败测试。
- [ ] 将每项替换为对应的 `USER_PERMISSIONS`、`ROLE_PERMISSIONS`、`AUDIT_PERMISSIONS` 等 contracts 常量；不复制字符串。
- [ ] 运行 `pnpm exec vitest run --project @auth-sso/portal apps/portal/__tests__/api/permission-enforcement.test.ts` 和 `pnpm typecheck`，确认通过且搜索无旧权限字面量。

### Task 4: Gateway issuer 快照和生产密钥

**Files:**
- Modify: `apps/gateway/src/jwks.rs`
- Modify: `apps/gateway/src/jwks/tests.rs`
- Modify: `apps/gateway/src/config.rs`
- Modify: `apps/gateway/src/config.rs` tests
- Modify: `packages/config/src/env.ts`
- Modify: `apps/portal/__tests__/helpers/helpers.test.ts`

- [ ] 写失败 Rust 测试：Discovery 无 issuer 时 refresh 返回错误且已安装 validation 不变；测试显式断言 `validate_aud=false`。
- [ ] 写 Portal/Gateway 配置测试：production 无或过短 `GATEWAY_SHARED_SECRET` 失败，开发/测试保留明确策略。
- [ ] 让首次 Discovery 严格要求 issuer；后台 refresh 仅在完整 metadata 成功时 `ArcSwap::store`；不得改动 audience 行为。为双方 production 配置加入同一最小长度验证。
- [ ] 运行 `cargo test --manifest-path apps/gateway/Cargo.toml`、`cargo clippy --manifest-path apps/gateway/Cargo.toml --all-targets --all-features -- -D warnings` 和相关 Vitest。

### Task 5: 重新生成唯一数据库基线和分区表

**Files:**
- Delete: `apps/portal/drizzle/0000_swift_rumiko_fujikawa.sql` 至 `0005_adr006-permission-namespace.sql`
- Delete: `apps/portal/drizzle/meta/*`
- Modify: `apps/portal/src/db/schema/{users,rbac,logs}.ts`
- Create: `apps/portal/drizzle/0000_initial.sql`
- Create: `apps/portal/drizzle/meta/0000_snapshot.json`
- Create: `apps/portal/drizzle/meta/_journal.json`
- Modify: `apps/portal/scripts/maintain-access-log-partitions.ts`

- [ ] 写 schema/迁移验证脚本：空数据库只运行 `pnpm db:migrate`；插入 access_logs 成功；当月/下月分区存在；维护脚本可重复执行与删除过期分区。
- [ ] 运行脚本，确认旧迁移会失败、当前 schema 的关联表尚非真实复合 PK。
- [ ] schema 改为 `primaryKey({ columns: [...] })`；access_logs 定义与手写 SQL 一致，使用 `(id, created_at)` 主键和按月 `PARTITION BY RANGE(created_at)`；唯一基线创建两个初始分区及全量索引/FK/枚举。
- [ ] 运行 `pnpm db:generate` 仅用于核对 schema，然后以生成结果/手写分区补丁生成唯一基线；空库 `pnpm db:migrate && pnpm db:seed` 必须成功。

### Task 6: CI、Redis、有界批处理、镜像与 metrics

**Files:**
- Modify: `.github/workflows/{main,pr}.yml`
- Modify: `apps/portal/src/infrastructure/redis/index.ts`
- Modify: `apps/portal/src/lib/{permissions,session/revoke}.ts`
- Modify: `apps/gateway/Dockerfile`
- Modify: `apps/gateway/src/metrics.rs` 与 `apps/gateway/src/gateway.rs`
- Add tests in the closest existing Portal/Gateway test files

- [ ] 写失败测试：批量 userIds 从不超过固定并发；Redis 断线不会无限 offline queue；metrics 暴露受控只读输出。
- [ ] CI 将 db:push 替换为 db:migrate；Redis 指定 connectTimeout、有限 retry 和 `enableOfflineQueue:false`；批处理采用固定 chunk（50）与有界并发；固定 Alpine 版本；添加受控 metrics route/端口并记录分区任务结果。
- [ ] 运行单测、CI YAML 静态检查、Gateway clippy/fmt/test。

### Task 7: 文档、roadmap 和全量回归

**Files:**
- Modify: `docs/spec/{API,DATABASE,DETAILED_DESIGN,ARCHITECTURE}.md`
- Modify: `docs/roadmap.md`
- Create: `docs/solution/2026-07-23-adr-aligned-audit-remediation.md`
- Modify: `docs/audit/2026-07-23-code-audit.md`

- [ ] 完整重读目标文档后，记录 ADR-006/007/008/009 对本次设计的约束、审计 `aud`/RT client 误报勘正、干净基线不可在线升级条件与实际验证结果。
- [ ] 更新 roadmap 为已完成项，并将本 solution 记录为数据库基线、OAuth 原子领取和 ADR 冲突识别的最佳实践。
- [ ] 全量运行：`pnpm lint && pnpm typecheck && pnpm test && pnpm test:report`，以及 Gateway `cargo fmt --all -- --check`、clippy、test；最后 `git diff --check`。

## Plan Self-Review

- ADR-006/007/008/009 的令牌、Gateway、权限约束均在 Task 1–4 明确保持；其余 ADR 不被改动。
- 每个改动任务先写失败测试并给出精确验证命令。
- 数据库重置、CI 验证、文档和 roadmap 都有独立可验收步骤。
