# Auth-SSO 系统路线图

本文档记录各模块完成状态与版本规划，与 docs/spec/REQUIREMENTS_MATRIX.md 联动。

## 模块状态

| 模块 | 状态 | 版本 | 备注 |
|------|------|------|------|
| 用户管理（CRUD/状态/改密） | ✅ 已交付 | v1.1 | 含密码历史 NFR-SEC-15 |
| 角色管理（RBAC v3.2） | ✅ 已交付 | v1.1 | 角色归属部门模型 |
| 权限管理（统一权限树） | ✅ 已交付 | v1.1 | DIRECTORY/PAGE/API 三类型 |
| 部门管理（物化路径树） | ✅ 已交付 | v1.1 | ancestors 子树查询 |
| OAuth 2.1 Provider | ✅ 已交付 | v1.1 | PKCE + 授权码 + Token 轮换 |
| OIDC Discovery | ✅ 已交付 | v1.1 | 含 end_session_endpoint |
| Gateway 边缘验签 | ✅ 已交付 | v1.1 | Pingora + ES256 + HMAC 签名 |
| 审计日志（180天分区） | ✅ 已交付 | v1.1 | append-only |
| 暴力破解防护 | ✅ 已交付 | v1.1 | Redis INCR 锁定 |
| SAML 2.0 | 🔲 待评估 | P2 | 未在本期范围，企业对接需求驱动 |
| OIDC RP-Initiated Logout | 🔲 待评估 | P2 | 当前用自定义 revoke 实现 |
| 多租户隔离 | ❌ 范围外 | - | PRD §2.2 明确排除 |

## 变更记录

- 2026-07-24: 合并 PR #24 中经 main 基线复核的测试与 CI 改进：补充 Redis 降级授权覆盖、Gateway ES256 安全验签覆盖、测试基础设施与需求追溯扫描；剔除未能形成有效断言的 E2E 草案。
- 2026-07-24: 完成全维度审计整治：OAuth scope allow-list/授权码原子领取/UserInfo 最小披露，Gateway issuer 与生产共享密钥约束，唯一数据库基线与分区调度，Controller 权限常量收敛、受控 Prometheus metrics、Temporal 领域时间边界、OAuth 浏览器授权码 E2E，以及 337 项 Vitest 全绿的共享数据库隔离修复。
- 2026-07-23: ADR-009 Gateway 重构全量完成（G1-G7），全量文档同步审计（14 份文档）；修复角色绑定事务边界、REST 错误契约、权限 SQL 分页与 OIDC 死类型
- 2026-07-16: Gateway 安全修复与性能优化完成（B1-B9/D1-D5/C1-C3/A1-A6，见下方区块）
- 2026-07-16: ADR-006/007/008 全量实现完成，合并 main（75 文件，307 测试全绿）
- 2026-07-15: ADR-006/007/008 产出，领域重构计划制定（来源：/grilling 深度访谈）
- 2026-07-13: 新增"审计驱动待办（基于 2026-07-13-code-audit.md，经代码实证勘误）"区块
- 2026-07-10: 初始化路线图，对齐 v1.1 交付状态

## 审计驱动待办（基于 2026-07-13-code-audit.md）

> 下表条目均经过对 HEAD 代码的实证复核；审计报告本身的 3 处事实错误（13.1 CI、2.1 audit success、6.1 遗漏项）已在报告中勘误，此处不再重复。

### P0 紧急修复（安全 / 可独立上线）

| # | 状态 | 任务 | 文件:行 | 来源发现 |
|---|:--:|------|---------|:--:|
| A0-1 | 🔲 | fire-and-forget → await（复核遗漏的 4 处安全关键调用） | `app/(dashboard)/users/actions.ts:120,232,282` + `app/profile/actions.ts:124` | 6.1 勘误 |
| A0-2 | ✅ | `revokeAllRefreshTokens` JTI 撤销 fire-and-forget（工作树已修复） | `lib/auth/token.ts:568-577` | 7.4（升级为严重） |
| A0-3 | 🔲 | CI 增补 `pnpm audit` / `cargo audit` 依赖安全扫描 | `.github/workflows/*` | 13.2 |
| A0-4 | ✅ | permissions 列表接口补 SQL 分页（page/pageSize/pagination） | `api/permissions/route.ts` + `permissions/data.ts` | 5.2 |
| A0-5 | 🔲 | 分页参数统一校验 + 提取 `MAX_PAGE_SIZE` 常量 | `contracts` + 4 个路由 | 5.1 |

### P1 规范统一

| # | 状态 | 任务 | 文件:行 | 来源发现 |
|---|:--:|------|---------|:--:|
| A1-1 | 🔲 | facade.ts 错误响应补 `success: false`（统一 ApiResponse 契约） | `lib/auth/facade.ts:56-59,64-67,78-81` | 2.1 |
| A1-2 | 🔲 | register 路由成功响应用 `data` 替代 `stats` | `api/permissions/register/route.ts:178` | 2.1 |
| A1-3 | 🔲 | `LOG_LEVEL` 生效 + 全量日志结构化 | `packages/config/src/env.ts:39` + Portal 全局 | 10.1, 10.2 |
| A1-4 | 🔲 | 管理员角色硬编码改为引用 `ADMIN_ROLE_CODES` | `app/profile/ProfileClient.tsx:270` | 11.1 |

### P2 公共抽取

| # | 状态 | 任务 | 文件 | 来源发现 |
|---|:--:|------|------|:--:|
| A2-1 | 🔲 | 审计日志写入抽取公共工厂（消除 3 次重复） | `lib/audit.ts` | 7.2 |
| A2-2 | 🔲 | 分页参数解析工具 `parsePagination()` | 新建 `lib/pagination.ts` | 14.5 |
| A2-3 | 🔲 | 日期范围过滤条件构建工具 | `app/audit/data.ts` | 14.2 |
| A2-4 | 🔲 | 密钥导入模式去重（`importJwk`） | `lib/auth/token.ts` | 3.4 |

### P3 架构优化

| # | 状态 | 任务 | 文件（实测行数） | 来源发现 |
|---|:--:|------|------|:--:|
| A3-1 | 🔲 | 拆分 token.ts（584 行 → sign/keys/rotate/revoke 四模块） | `lib/auth/token.ts` | 3.1 |
| A3-2 | 🔲 | 分离 gateway.rs 的 OAuth client 逻辑（853 行） | `gateway/src/gateway.rs` | 3.2 |
| A3-3 | 🔲 | facade.ts 解耦 NextResponse（业务层返回结果对象） | `lib/auth/facade.ts` | 3.5 |
| A3-4 | 🔲 | 健康检查加 DB/Redis 连通性探测 | `api/health/route.ts` | 10.3 |

### P4 质量防护

| # | 状态 | 任务 | 文件 | 来源发现 |
|---|:--:|------|------|:--:|
| A4-1 | 🔲 | 重写虚假覆盖率测试（audit-logging、user-actions 等） | `__tests__/api/*` | 12.1-12.3 |
| A4-2 | 🔲 | 补充 CRUD write 路径集成测试 | `tests/integration/` | 12.6 |
| A4-3 | 🔲 | auth-login 测试降低 mock 粒度，真实测密码验证 | `__tests__/api/auth-login.test.ts` | 12.4 |
| A4-4 | 🔲 | session-lifecycle 测试恢复 jose 真实验签 | `__tests__/api/session-lifecycle.test.ts` | 12.5 |

### P5 细节清洁

| # | 状态 | 任务 | 文件 | 来源发现 |
|---|:--:|------|------|:--:|
| A5-1 | 🔲 | Dockerfile 层缓存优化（先 COPY lockfile 后 install） | `apps/portal/Dockerfile` | 13.3 |
| A5-2 | 🔲 | 恢复 tsconfig 3 个 strict 子选项 | `apps/portal/tsconfig.json:14-16` | 13.4 |
| A5-3 | 🔲 | PortalJwtClaims 跨语言契约（JSON Schema 权威定义） | `domain/auth/types.ts` + `gateway/auth/mod.rs` | 7.5 |
| A5-4 | 🔲 | trace-id 跨服务传播 | `lib/auth/server-logger.ts` | 10.4 |
| A5-5 | 🔲 | Cookie Secure 增加独立配置（非仅依赖 NODE_ENV） | `lib/session/cookies.ts` | 9.3 |
| A5-6 | 🔲 | 文档版本号统一 | `docs/spec/API.md` 等 | 2.4 |

---

## ADR-006/007/008 领域重构（2026-07-15 /grilling 产出）

> 详细计划：`docs/plans/2026-07-15-adr-006-007-008-implementation.md`

### Phase 1: Schema & Migrations

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D1-1 | ✅ | permissions: 删除 `resource`/`action` 列，扩展 `code`→varchar(150)，更新 CHECK | `db/schema/rbac.ts` |
| D1-2 | ✅ | refresh_tokens: 删除 `client_id` 列及索引 | `db/schema/auth.ts` |
| D1-3 | ✅ | 生成并执行迁移 SQL | Drizzle migration |

### Phase 2: Contracts

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D2-1 | ✅ | 所有权限常量加 `portal:` 前缀 | `packages/contracts/src/permissions.ts` |
| D2-2 | ✅ | `PortalJwtClaims` 最小化（移除 roles/permissions/deptIds） | `domain/auth/types.ts` |
| D2-3 | ✅ | OIDC 常量 `iss`/`aud` 改为 `"auth-sso"` | `packages/contracts/src/oidc.ts` |

### Phase 3: JWT Token 签发/验证

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D3-1 | ✅ | `signAccessToken` 最小化 claims | `lib/auth/token.ts` |
| D3-2 | ✅ | `verifyAccessToken` aud/iss 改为 `"auth-sso"` | `lib/auth/token.ts` |
| D3-3 | ✅ | `resolveTokenClaims` 不再返回鉴权数据供 JWT 嵌入 | `lib/auth/permissions.ts` |

### Phase 4: 权限上下文 Redis 化

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D4-1 | ✅ | RBAC 变更时主动更新 Redis `user:{sub}:perms` | `lib/permissions.ts` |
| D4-2 | ✅ | Token 续签时预填充 Redis 权限缓存 | `lib/permissions.ts` |

### Phase 5: Portal 自身鉴权改造

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D5-1 | ✅ | `checkPermission` 改为读 Redis | `lib/auth/check-permission.ts` |
| D5-2 | ✅ | `withPermission` 移除 claims 注入 | `lib/auth/guard.ts` |
| D5-3 | ✅ | `withAuth` AuthContext 简化为 `{ userId }` | `lib/auth/guard.ts` |
| D5-4 | ✅ | 所有 Controller/Page 去除 `claims.deptIds` 直接引用，改为 Redis 获取 | `app/(dashboard)/**`, `app/api/**` |

### Phase 6: Refresh Token 去 ClientId

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D6-1 | ✅ | `issueRefreshToken` 移除 clientId 参数 | `lib/auth/token.ts` |
| D6-2 | ✅ | `rotateRefreshToken` 移除 clientId 参数 | `lib/auth/token.ts` |
| D6-3 | ✅ | 调用方更新（/token /refresh 端点） | `app/api/auth/oauth2/token/route.ts`, `app/api/auth/refresh/route.ts` |

### Phase 7: Gateway 改造 (Rust)

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D7-1 | ✅ | Claims 结构体移除 roles/permissions/dept_ids | `gateway/src/auth/mod.rs` |
| D7-2 | ✅ | 验签 issuer 固定为 `"auth-sso"`；aud 按 ADR-006 不在 Gateway 校验 | `gateway/src/auth/verify.rs` |
| D7-3 | ✅ | 移除 X-User-Roles/Permissions/DeptIds 注入 | `gateway/src/gateway.rs` |

### Phase 8: Seed 数据

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D8-1 | ✅ | 权限 code 加 `portal:` 前缀；删除 resource/action 赋值 | `scripts/seed-rbac.ts` |
| D8-2 | ✅ | Portal 菜单 code 加 `portal:` 前缀 | `scripts/seed-rbac.ts` |

### Phase 9: 测试更新

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D9-1 | ✅ | 鉴权测试适配（mock Redis 替代 JWT claims） | `__tests__/lib/auth/*` |
| D9-2 | ✅ | API 测试适配（aud/iss claims 移除） | `__tests__/api/*` |
| D9-3 | ✅ | Gateway 测试适配（Claims 结构体） | `apps/gateway/src/auth/tests.rs` |

---

## ADR-009 Gateway 重构（2026-07-16 /grilling 产出）

> ADR-009 已于 2026-07-23 全量实现完成，经 `cargo clippy` + `cargo fmt` + `cargo test` 全绿验证。详见 `apps/gateway/src/auth/mod.rs`、`gateway/src/authenticate.rs`、`gateway/src/config.rs`。

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| G1-1 | ✅ | 新增 `AuthDecision` 枚举（Pass/Interrupted/PkceRequired） | `gateway/src/auth/mod.rs` |
| G1-2 | ✅ | `authenticate::check` 重写：`Result<bool>`→`Result<AuthDecision>`，`match expiry` 替代 `matches!`，删除 `respond_auth_failure` | `gateway/src/authenticate.rs` |
| G2-1 | ✅ | 删除 `request_filter` step 7（`hasJwt` Cookie 预判） | `gateway/src/gateway.rs` |
| G2-2 | ✅ | 删除 callback 中 `oidc_provider_name` 跳过分支 | `gateway/src/gateway.rs` |
| G2-3 | ✅ | 删除 callback 透传分支（`client_secret.is_some()` 检查 + passthrough） | `gateway/src/gateway.rs` |
| G2-4 | ✅ | step 8 替换为 `match AuthDecision` 统一分支 | `gateway/src/gateway.rs` |
| G3-1 | ✅ | `OAuthConfig.client_secret` → `String`（必填），`UpstreamConfig.oauth` → 必填 | `gateway/src/config.rs` |
| G3-2 | ✅ | 删除 `Gateway.oidc_provider_name`、`GatewayCtx.oauth_passthrough_verifier` | `gateway/src/gateway.rs` |
| G3-3 | ✅ | `resolve_oauth` 返回 `&OAuthConfig`（不再 `Option`） | `gateway/src/gateway.rs` |
| G4-1 | ✅ | 删除 `upstream_request_filter` 中 `X-OAuth-Code-Verifier` 注入 | `gateway/src/gateway.rs` |
| G4-2 | ✅ | `handle_oauth_callback` 删除 `client_secret.is_some()` 分支 + passthrough | `gateway/src/gateway.rs` |
| G5-1 | ✅ | 增补 `AuthDecision` 单元测试 | `gateway/src/auth/tests.rs` |
| G6-1 | ✅ | `gateway.toml` + `gateway.docker.toml` 增加必填 `client_secret` | 配置文件 |
| G7-1 | ✅ | `cargo clippy` + `cargo fmt` + `cargo test` 全绿验证 | CI |

---

## Gateway 安全修复与性能优化（2026-07-16 审计驱动）

> 计划：`.kilo/plans/1784180149059-gateway-security-fixes.md`；最佳实践沉淀见 `docs/solution/`。

| # | 状态 | 任务 | 审计项 |
|---|:--:|------|:--:|
| S1 | ✅ | 扩展名白名单边界收窄（/api/ 命名空间禁止扩展名旁路，优先级降至 Microservice 后） | B1/D5 |
| S2 | ✅ | 客户端 IP 改用 socket 真实地址；XFF/X-Real-IP/X-Client-IP 权威覆写 | B2/B7 |
| S3 | ✅ | scheme 判定统一为 `is_secure_host`（IP 解析 + is_loopback），删除重复实现 | B3 |
| S4 | ✅ | 续签去重改 Redis SET NX EX 前置抢占 + 失败释放（消除 TOCTOU） | B4 |
| S5 | ✅ | Token 交换跨节点故障转移（网络错误换节点，非 2xx 确定性拒绝） | B5 |
| S6 | ✅ | PKCE return_to 保留 query | B6 |
| S7 | ✅ | `query_param` 重写（大小写敏感、零分配）+ IdP error 回调显式处理 | C3/B8/B9 |
| S8 | ✅ | 单一路由表 RouteEntry（prefix+LB+OAuth 同源）+ 上游 TLS 生效 | D2/A2/A3 |
| S9 | ✅ | JWKS 缓存 ArcSwap 快照化（删除锁中毒分支）+ upstream_scheme 显式注入 | D1/A1 |
| S10 | ✅ | Cookie 热路径：ctx 缓存一次 collapse + 单遍重写 + strip 零分配 | D3/C1/C2 |
| S11 | ✅ | public_paths 归属校验（越界白名单启动期拒绝） | A4 |
| S12 | ✅ | 删除 get_host `:authority` 死分支；callback 判定零分配 | A6/D4 |

不做（Out of scope）：trusted-proxy 层级配置、Redis 缓存新 AT、C4 Bearer 拼接微优化、分布式限流。

### 状态图例

- 🔲 待处理 ｜ ⏳ 进行中 ｜ ✅ 已完成 ｜ ⚠️ 有阻塞
