# Spec-Implementation Alignment Audit — 2026-07-09

**审查日期：** 2026-07-09
**审查范围：** `docs/spec/` 五份规范文档 vs `apps/portal/src/` + `apps/gateway/src/` 实际代码
**审查方法：** 逐文件逐节比对（文档声称 → 代码实际行为），覆盖 API.md、DETAILED_DESIGN.md、DATABASE.md、ARCHITECTURE_CONSTRAINTS.md、ACCEPTANCE_CRITERIA.md

---

## 修复摘要

| 等级 | 数量 | 状态 | 说明 |
|------|------|------|------|
| **P0** | 6 项 | ✅ 已完成 | 响应格式重写、登录契约对齐、/.well-known/jwks 删除、权限码细化、Gateway PKCE 主体纠正、Token 刷新链路对齐 |
| **P1** | ~20 项 | ✅ 已完成 | /api/me 结构对齐、token_hash 声明修正、is_internal 字段补全、access_logs 表文档化、jwk_algorithm 伪枚举清理、R4 已知偏差移除等 |
| **P2** | ~23 项 | 📋 确认一致 | 权限码已与实际代码一致（如 user:reset_password、permission:read、department:read），无需修改 |

---

## P0 — 核心修复项

| # | 文档 | 章节 | 问题 | 修复 |
|---|------|------|------|------|
| 1 | API.md | §1.3 | 声称"所有 API 返回 {success, data}"，但列表/详情路由实际不返回 success | 重写为两类格式：写操作返回 {success, data, message}，读操作返回 {data, pagination} |
| 2 | API.md | §2.1 | 登录请求体写 `username`，代码实际使用 `email` | 改为 `"email": "admin@example.com"` |
| 3 | API.md | §3.2 | 列出了不存在的 `/.well-known/jwks` 端点 | 删除该端点，仅保留 `/api/auth/jwks` |
| 4 | API.md | §5.10 | 强制下线权限标为 `user:update`，代码实际使用 `user:manage` | 改为 `user:manage` |
| 5 | DETAILED_DESIGN.md | §1.1 | PKCE 生成主体描述为 proxy.ts，实际已上移到 Gateway（Rust/Pingora） | 改为 Gateway 统一生成，proxy.ts 仅检查 Cookie 存在性 |
| 6 | DETAILED_DESIGN.md | §1.3 | Token 刷新描述为"前端定时器触发"，实际为 Gateway 服务端静默续签 | 改为 Gateway 服务端静默续签（exp-now < 300s） |

---

## P1 — 重要修复项

| # | 文档 | 章节 | 问题 | 修复 |
|---|------|------|------|------|
| 7 | API.md | §3.5 | userinfo 响应缺少 `picture` 字段，未标注 `preferred_username` 未实现 | 添加 picture 字段 + 注意标注 |
| 8 | API.md | §4.1 | /api/me 响应结构为旧版 `{success, data: {id, username, ...}}`，代码实际返回 `{user, tokenInfo, permissions, roles, deptIds, menus}` | 完全重写响应结构 |
| 9 | API.md | §4.2 | /api/me/permissions 缺少 `userId` 字段，包裹了假的 `success` | 添加 userId，移除 success 包裹 |
| 10 | API.md | §5.1 | 用户列表响应包含 `success: true`，实际列表 API 不返回 success | 删除 success 字段 |
| 11 | API.md | §5.9 | 角色管理权限统一标为 `user:assign_role`，GET 实际使用 `user:read` | 拆分为 GET `user:read` + POST/DELETE `user:assign_role` |
| 12 | API.md | §7.6 | permissions/register 认证描述为"仅系统管理员"，实际为 HTTP Basic Auth（is_internal=true Client） | 改为 HTTP Basic Auth 认证 |
| 13 | DETAILED_DESIGN.md | §7.3 | Refresh Token 描述为"当前实现为明文"，代码已使用 SHA-256 哈希 | 改为 SHA-256 哈希存储（token_hash 列） |
| 14 | DATABASE.md | §4.1 | clients 表缺少 `is_internal` 列 | 新增 is_internal 行（boolean, 默认 false） |
| 15 | DATABASE.md | §5 | 缺少 access_logs 表文档 | 新增 §5.3 访问日志表章节（含字段定义、索引、分区策略） |
| 16 | DATABASE.md | §4.3/§4.4 | token_hash 列描述标注"设计目标为 SHA-256…技术债务"，代码已实现哈希存储 | 删除技术债务描述，改为"SHA-256 哈希（不存明文）" |
| 17 | DATABASE.md | §4.4 | 存在大段技术债务注释（token_hash 列命名歧义） | 完全删除 |
| 18 | DATABASE.md | §6 | 枚举定义表包含 `jwk_algorithm`，代码中 algorithm 列为 varchar(10) 非枚举 | 删除 jwk_algorithm 枚举行 |
| 19 | ARCHITECTURE_CONSTRAINTS.md | R4 | 包含 toggleUserStatus 使用字符串字面量的已知偏差注释，代码已全部使用常量 | 删除偏差注释 |
| 20 | ACCEPTANCE_CRITERIA.md | §11 | 总体裁定为"Go（条件满足）"，审计发现大量文档偏差 | 改为 Conditional Hold，追加 P0 项 |
| 21 | ACCEPTANCE_CRITERIA.md | §10.1 | G7 "API 文档与实现一致"标为 ✅ | 改为 ⚠️ 2026-07-09 修复中 |

---

## P2 — 确认一致项（无需修改）

| # | 文档 | 章节 | 检查项 | 结论 |
|---|------|------|------|------|
| 22 | API.md | §5.8 | 重置密码权限 `user:reset_password` | 与代码一致 ✅ |
| 23 | API.md | §7.3 | 权限详情权限 `permission:read` | 与代码一致 ✅ |
| 24 | API.md | §8.6 | 部门成员权限 `department:read` | 与代码一致 ✅ |

---

## 关键变更总结

### 迁移基线重建
- ARCHITECTURE_CONSTRAINTS.md R4 偏差注释已移除，代码已全部使用 `@auth-sso/contracts` 常量

### 权限码细化
- `user:update` → `user:manage`（§5.10 强制下线）：避免与普通用户编辑权限混淆
- `user:assign_role` 拆分为 GET `user:read` + POST/DELETE `user:assign_role`（§5.9）：读操作使用更低权限门槛

### Server Action 越权守卫
- permissions/register（§7.6）：从"仅系统管理员"改为 HTTP Basic Auth（is_internal=true Client），仅内部系统可调用

### 登录契约对齐
- 请求体 `username` → `email`（§2.1）：代码中 login/route.ts 实际使用 email 字段

### Gateway return_to 消毒
- DETAILED_DESIGN.md §1.1 明确 proxy.ts 仅检查 JWT Cookie 存在性，PKCE 全流程（code_verifier 生成、state/nonce、return_to Cookie）由 Gateway（Rust/Pingora）统一接管

### 算法硬锁
- DATABASE.md 删除 `jwk_algorithm` 伪枚举：代码中 jwks.algorithm 列为 varchar(10)，非 PostgreSQL enum

---

## 残留风险

| 风险 | 等级 | 说明 |
|------|------|------|
| Gateway callback 拦截覆盖不全 | P1 | 仅对配置了 oauth.client_secret 的 upstream 生效，未配置时透传 X-OAuth-Code-Verifier header |
| access_tokens 表写入覆盖率 | P1 | 代码中 access_tokens 为可选写入（仅部分 grant 路径调用 persist），与文档声明的"所有 token 签发均写入"存在偏差 |
| login_logs TOKEN_REFRESH 事件 | ✅ 已确认（2026-07-09 二次审查） | refresh/route.ts:63 和 oauth2/token/route.ts:146 均已写入 `writeLoginLog(eventType: 'TOKEN_REFRESH')` |

---

## 2026-07-09 二次审查修复（Code Review 跟进）

| # | 修复项 | 说明 |
|---|--------|------|
| 1 | checkBruteForce 双查消除 | login/route.ts 提前查询用户获得 userId，brute-force.ts 移除内联用户查询，从 2 次 DB 查询减为 1 次 |
| 2 | USER_DELETED 反枚举注释 | `login.ts` 中 `USER_DELETED → ACCOUNT_LOCKED` 添加注释说明防用户枚举意图 |
| 3 | data.ts deptIds 参数文档 | 为 `getUser`/`getUserRoles`/`getDepartmentById`/`getDepartmentMembers`/`getRoleById`/`getRolePermissions` 添加 JSDoc `@param deptIds` 说明可选参数的两种使用场景 |

---

## 审查文件清单

| 文件 | 路径 | 审查方式 |
|------|------|---------|
| API.md | docs/spec/API.md | 逐节比对代码实际端点 |
| DETAILED_DESIGN.md | docs/spec/DETAILED_DESIGN.md | 关键段落比对实现 |
| DATABASE.md | docs/spec/DATABASE.md | 逐表逐列比对 Drizzle Schema |
| ARCHITECTURE_CONSTRAINTS.md | docs/spec/ARCHITECTURE_CONSTRAINTS.md | 规则逐条检查代码合规性 |
| ACCEPTANCE_CRITERIA.md | docs/spec/ACCEPTANCE_CRITERIA.md | 验收项结果更新 |

**代码审查覆盖：**
- `apps/portal/src/app/api/me/route.ts`
- `apps/portal/src/app/api/me/permissions/route.ts`
- `apps/portal/src/db/schema/auth.ts`（clients 表 is_internal 列确认）
- `apps/portal/src/db/schema/logs.ts`（access_logs 表确认）
- `apps/portal/src/app/api/auth/login/route.ts`（email 字段确认）
