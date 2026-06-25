# Spec ↔ 实现 对齐审查报告

> 审查日期：2026-06-25
> 修复日期：2026-06-25（同日修复）
> 审查范围：`docs/spec/*` 与 `apps/portal`、`apps/gateway/src`、`packages/*` 的需求/设计/数据库/实现/测试五层对齐
> 方法：5 个并行维度（DB Schema / RBAC 数据范围 / Auth-OIDC-Gateway / API 契约 / Contracts-需求-测试）逐文件比对
>
> **修复状态**：P0 安全 6/6 ✅ | RBAC 5/7 ✅ | 文档 11 项 ✅ | 测试 255/255 ✅ | 覆盖率 63/70 (90.0%) ✅ | 未识别 @req 0 个

## 修复摘要（2026-06-25）

| # | 问题 | 状态 |
|---|------|------|
| S1 | 敏感操作绕过数据范围 | ✅ 已修复 — 新增 `canAccessDept` helper，应用于 6 个路由 |
| S2 | introspect/revoke 零认证 | ✅ 已修复 — 增加 client_id+secret 校验 |
| S3 | permissions/register 鉴权降级 | ✅ 已修复 — 增加 `validateClientActive` 检查 |
| S4 | 开放重定向 + PKCE 可绕过 | ✅ 已修复 — redirect_uri 精确匹配 + PKCE 强制 |
| S5 | JWT aud 全链路无人校验 | ✅ 已修复 — verifyAccessToken 加 audience + Gateway 信任路径 aud 断言 |
| S6 | state 仅校验存在性 | ✅ 已修复 — safeRedirectPath 同源消毒 |
| A2 | validateDeptConstraint 缺 ACTIVE 过滤 | ✅ 已修复（上轮） |
| A3 | TOCTOU（deptId 读写不在同一事务） | ✅ 已修复 — 事务内重读 deptId |
| A4 | deptId null 短路放行 | ✅ 已修复（上轮） |
| A6 | Cookie 路径不一致 | ✅ 已修复 — refresh + logout 路径统一 |
| D1 | CLAUDE.md Gateway 描述错误 | ✅ 已修复 |
| D2 | DATABASE.md 关键漂移 | ✅ 部分修复 — roles 表、consents 标记、头部说明 |
| R1 | 需求矩阵 C 模块计数 | ✅ 已修复 — 8→6 |
| R3 | 授权码 TTL 矛盾 | ✅ 已修复 — 1min→5min |
| T1 | CLAUDE.md 测试文件引用 | ✅ 已修复 |
| - | contracts 死代码 | ✅ 已清理 |
| A5 | 前端分配角色死按钮 | ⏸️ 功能缺口，非 Bug |
| A7 | refresh 不检查剩余时间 | ⏸️ 优化项 |
| D2 全文/D3/D4/R2/T2-T5 | 文档全文更新/测试追溯 | ⏸️ 待后续批处理 |

---

## 一、最高优先级（🔴 安全 / 架构矛盾）

### S1. 敏感写操作绕过数据范围过滤（越权）
- `apps/portal/src/app/api/users/[id]/reset-password/route.ts:21` — 仅 `user:update`，无 `getUserRoleDeptIds` 校验
- `apps/portal/src/app/api/users/[id]/force-logout/route.ts:34` — 仅 `user:manage`，无校验
- `apps/portal/src/app/api/users/[id]/roles/route.ts` GET(:31)/POST(:42)/DELETE(:80) — 均无范围过滤
- `apps/portal/src/app/api/roles/route.ts`、`roles/[id]/route.ts` — 角色列表/详情无范围过滤（全系统角色可被枚举）
- **影响**：任何持有 `user:update`/`user:manage`/`role:read` 的角色可跨部门重置密码 / 强制下线 / 篡改角色绑定，违反 R-DATA-SCOPE / H-ACL-002 / H-DSCOPE-003。

### S2. introspect / revoke 端点零认证
- `oauth2/introspect/route.ts:15` — 任何人 POST `{token}` 即可探测任意 access/refresh token 有效性 + sub/scope/clientId
- `oauth2/revoke/route.ts:17` — 任意 jti/refresh token 可被强制撤销（DoS / 踢人下线）
- 违反 RFC 7662 §2.1 / RFC 7009（要求 client 认证）。API.md:1875/DETAILED_DESIGN §9 声明遵循 RFC，实现不符。

### S3. `permissions/register` 鉴权降级（与文档冲突）
- API.md:1219 声明需 `permission:manage` + JWT Cookie；代码 `permissions/register/route.ts:101` 改用 Basic Auth（client_id+secret），任何子系统可批量注册/废弃权限（`:158-163` 把缺失 code 标记 DISABLED）。

### S4. 开放重定向 + PKCE 可绕过
- `domain/auth/oauth-client.ts:57` redirect_uri 用 `startsWith`（前缀放行），白名单 `https://app.example.com/cb` 会放行 `https://app.example.com/cb.evil.com/...`
- `oauth2/token/route.ts:71` PKCE 在 `codeChallenge` 缺失时跳过校验（OAuth 2.1 要求强制）。

### S5. JWT `aud` 全链路无人校验
- `gateway.rs:222` `validate_aud = false`；Portal 在 Gateway 信任路径下（`X-User-Id` 存在）`verify-jwt.ts:78` 直接 decode 不验签也不校验 aud。为 client A 签发的 token 拿到 client B 会被接受。

### S6. H-AUTH-010 state 仅校验存在性，不校验一致性
- `callback/route.ts:30-34` 只检查 `state` 非空，未与原始 state 比对 → CSRF 防护降级。nonce 无 Portal 端回放校验。

---

## 二、🔴 文档与代码不一致（实现正确，文档错误）

### D1. CLAUDE.md "Gateway 不查 DB/Redis" 描述错误
- 事实：`gateway.rs:242-264` 验签后**立即查 Redis jti 黑名单**；`main.rs:97-124` 初始化 Redis。代码正确（H-SESS-006 即时失效依赖此）。CLAUDE.md 与 `main.rs:36` "100% 无 I/O" 启动横幅需修正。
- 残留风险（已记录、可接受）：Redis 宕机期间 jti 检查 fail-open（`gateway.rs:247` 注释 "安全降级放行"），撤销的 token 在 AT 自然过期前（≤1h）可用。

### D2. DATABASE.md 系统性漂移（v2 升级未同步全文）
- 所有表 `id`/`*_id` 文档标 `text`，实际全 `uuid().defaultRandom()`（users.ts:28、rbac.ts:43、org.ts:26、auth.ts:52…）
- 所有时间列文档标 `timestamp`，实际 `timestamp({withTimezone:true})`（helpers.ts:16,25）
- `roles.dept_id`：DATABASE.md:105 写 text，RBAC_MODEL_REDESIGN.md §3.1 写 uuid，代码为 uuid —— 两份文档自相矛盾
- §4.1 clients 表文档仍有 `public_id` 列，实际 clients 表无（`auth.ts:33-46`，PK 即 `client_id`）
- §4.5 consents 表文档完整描述，实际已删（`auth.ts:18` 注释"移除 consents"）
- §7 外键表：authorization_codes/access_tokens/refresh_tokens 的 `client_id` 文档写 →`clients.id`，实际 →`clients.client_id`（业务键），与 permissions.client_id 同
- §6/§9 残留 "menus" 表引用（已合并进 permissions）

### D3. API.md 大面积过时
- 写端点（POST/PUT/DELETE users/roles/clients/departments）文档给出完整 curl 与响应，实际**全部未实现 REST**（走 Server Action）—— 14 个文档端点缺失
- `permission_type` / 响应信封 `{code:"OK",message,data}` 文档示例在代码中不存在
- 错误码三套并存：contracts 用 `AUTH_SSO_xxxx`、API.md 示例用 `USER_NOT_FOUND` 等短码（部分如 `ROLE_HAS_USERS`/`DEPARTMENT_HAS_CHILDREN` contracts 中不存在）、login/refresh 硬编码裸字符串
- 权限码文档 vs 代码多处冲突（reset-password 文档 `user:reset_password` vs 代码 `user:update`；login-logs 文档 `login_log:read` vs 代码 `audit:read`；等）
- introspect/revoke 文档声明 `x-www-form-urlencoded`，代码只接受 JSON
- `GET /api/me` / `me/permissions` / userinfo / discovery 字段都与文档不符（deptIds 替代 dataScopeType+deptId 但文档未更新）
- 残留 10+ 处 `dataScopeType`（API.md:157,317,885,895,922,932,944,971,994,1003）

### D4. USER_STORIES.md 术语漂移（31 处）
- 仍引用已删除的 `role_data_scopes` 表（:1635）、`DEPT`/`DEPT_AND_SUB` 枚举（:1648,1651）
- 仍按旧 ALL/DEPT_AND_SUB/DEPT 三分模型描述数据范围（:172）
- 完全不引用 H-DSCOPE-001~003

---

## 三、🔴 需求矩阵内部错误

### R1. 汇总算术错误
- REQUIREMENTS_MATRIX.md:188 声明"合计 70 / P0 28 / P1 31 / P2 11"
- 实际逐行加总：**总数 72**（非 70）、**P1 33**（非 31）；P0=28、P2=11 正确

### R2. 被引用但不存在的需求 ID
| ID | 引用位置 |
|---|---|
| `C-ROL-CA` | role-api.test.ts:13、USER_STORIES:477,1774、coverage-report |
| `C-ROL-DS` | role-api.test.ts:13、USER_STORIES:493,1775、RBAC_MODEL_REDESIGN:258、coverage-report |
| `H-DSCOPE-004/005/006` | RBAC_MODEL_REDESIGN:258（"001~006"范围）、coverage-report |
| `H-ACL-004/005` | coverage-report、permission-enforcement.test.ts:14,165 |

矩阵模块 C 实际只有 C-ROL-L/C/U/D/PA/ASGN；H-DSCOPE 只有 001~003；H-ACL 只有 001~003。需决策补 ID 还是清理引用。

### R3. 授权码 TTL 自相矛盾（P0）
- REQUIREMENTS_MATRIX.md H-AUTH-003（:107）："授权码有效期 **1 分钟**"
- DETAILED_DESIGN.md §1.1(:144)/§7.3(:761) + 代码 `authorize/route.ts:91`：**5 分钟**
- 需确认基准（OAuth 2.1 推荐 ≤10min，1min 更严格）。

---

## 四、🟠 RBAC v3.2 实现层缺陷

| # | 问题 | 位置 |
|---|---|---|
| A1 | `UserPermissionContext.deptIds` 缓存**未做子树展开**，与 JWT claims（展开）语义二义 | `lib/permissions.ts:106-113` vs `token.ts:255` |
| A2 | R-USER-ROLE 后端校验无 `status='ACTIVE'` 过滤 → 可绑定已禁用角色（绑了拿不到权限，静默失败） | `users/[id]/roles/route.ts:22-28` |
| A3 | R-USER-ROLE 校验与 insert 非同一事务、未锁 users.deptId → TOCTOU | 同上 |
| A4 | `GET /api/users/[id]` 对 `dept_id IS NULL` 用户跳过检查（短路放行） | `users/[id]/route.ts:37` |
| A5 | 前端"分配角色"按钮无 onClick（死按钮），R-USER-ROLE 前端约束完全未实现 | `UserTable.tsx:236-238` |
| A6 | refresh cookie 路径前后不一：callback 写 `/api/auth/refresh`，refresh 端点写 `/`，logout 用 `/` 清除（清不掉 callback 写的） | callback:101 / refresh:50 / logout:79 |
| A7 | `Portal /api/auth/refresh` 不检查"剩余<5min"，任何时刻都刷新（H-SESS-003 仅 Gateway 路径成立） | refresh/route.ts:14-66 |

---

## 五、🟠 测试追溯断链

| # | 问题 |
|---|---|
| T1 | CLAUDE.md "Key Test Files" 声明 `sso-security.test.ts`（PKCE/State/Nonce），**文件不存在**。H-AUTH-010/011/012/013（全 P0）追溯断链 |
| T2 | `permission-enforcement.test.ts:86,308` mock 残留旧 `deptId` claim（应仅 `deptIds`） |
| T3 | `coverage-report.md` 分母错误（41/90，实际矩阵 72 项），且早于矩阵更新一天 |
| T4 | RBAC 越权场景零覆盖：reset-password / force-logout / 角色列表数据范围、introspect 无认证 |
| T5 | `role-api.test.ts` @req 引用 C-ROL-CA/DS（不存在），且实际无 POST/PUT/DELETE 用例 |
| ✅ | `data-scope.test.ts` 已正确按 v3.2 重写（getUserRoleDeptIds + 子树展开，H-DSCOPE-001~003） |
| ✅ | `session-lifecycle.test.ts` 覆盖 H-SESS（但 coverage-report 未扫到 @req） |

---

## 六、🟡 轻微 / 残留清理

- `db/resolve-id.ts:9` `byIdOrPublicId` 已无 public_id 逻辑，应改名 `byId`；调用方注释（force-logout:37、dashboard data.ts）误导
- `contracts/index.ts:67` 残留 `PUBLIC_ID_PREFIX.MENU`（menus 表已删）
- `contracts/index.ts:19` `CLIENT_TYPE_VALUES` 无表消费（clients 表无 clientType 列）
- `force-logout/route.ts:41` 注释说兼容 publicId，实际只 `eq(id,id)`
- JWKS 端点暴露所有历史密钥（含过期），无 `WHERE expiresAt>now`
- ID_TOKEN_TTL 硬编码 3600，与 ACCESS_TOKEN_TTL 脱钩
- `[...all]` 路由不存在（未匹配 /api/auth/* 返回 Next 默认 404 而非 JSON）

---

## 七、已验证对齐（无问题）

- ✅ `roles.dept_id` NOT NULL + FK + CASCADE（rbac.ts:47）
- ✅ `role_data_scopes` / `role_clients` 表与 relations 已彻底移除
- ✅ `data_scope_type` 列与枚举已移除（schema/contracts 零残留）
- ✅ `permission_type` = DIRECTORY/PAGE/API/DATA（enums.ts + contracts 一致）
- ✅ `getUserRoleDeptIds` 核心逻辑正确（user→roles.dept_id→ancestors LIKE 子树→去重，空角色返回 []）
- ✅ 旧三函数 `getDataScopeFilter`/`applyDataScopeFilter`/`checkDataScope` 已全部删除
- ✅ JWT claims v3.2 `deptIds` 全链路（Portal jose 签发 ↔ Gateway Rust claims.rs 解析）
- ✅ JWKS ES256 离线验签 + kid 匹配 + 90 天轮换 + 冷启动锁
- ✅ Cookie HttpOnly+Secure+SameSite=Lax
- ✅ 部门删除检查子部门/用户、角色删除检查关联用户
- ✅ ARCHITECTURE_CONSTRAINTS R7/DC-ROLE-C 已更新为 dept_id 模型

---

## 八、修复优先级建议

| 优先级 | 项 |
|---|---|
| **P0 安全** | S1（敏感操作数据范围）、S2（introspect/revoke 认证）、S3（permissions/register 鉴权）、S4（redirect_uri+PKCE）、S5（aud 校验）、S6（state 一致性） |
| **P0 文档** | D2（DATABASE.md 全面更新）、R1（矩阵算术）、R3（授权码 TTL）、R2（死链 ID 决策）、T1（sso-security.test.ts 或 CLAUDE.md） |
| **P1 一致性** | D3（API.md 重写）、D4（USER_STORIES 清理）、A1-A7（RBAC 实现缺陷）、T2-T5（测试追溯） |
| **P2 清理** | 第六节轻微项 |
