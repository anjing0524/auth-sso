# Database Redesign — DBA 系统性审查与重建方案

> 审查日期：2026-06-22
> 基线：`apps/portal/src/db/schema/` + `apps/portal/drizzle/`
> 关联：[DATABASE.md](./DATABASE.md)、[REQUIREMENTS_MATRIX.md](./REQUIREMENTS_MATRIX.md)、[USER_STORIES.md](./USER_STORIES.md)

## 一、审查结论

当前 17 张表，存在 5 类系统性问题，目标精简为 **15 张表**，消除约 **30 个冗余列**。

---

## 二、发现的问题

### P0-1: 双主键模式 (`id` + `public_id`) 冗余

每张实体表同时拥有 `id`（内部 UUID）和 `public_id`（带前缀外部 ID），导致：
- 每表多一个 UNIQUE 约束 + 索引
- 所有查询需 `byIdOrPublicId()` 辅助
- `public_id` 不过是 `prefix + random`，本质仍是不透明 ID

**修正**：统一使用 `uuid` 类型的 `id`。API 层如需对外展示，用 `username`（用户）或 `code`（角色/权限）等自然键。

### P0-2: `clients` 表三标识符 (`id` + `public_id` + `client_id`)

三个唯一标识列，且 FK 引用目标不一致：
- Token/Consent 表 → `clients.id`
- Permissions/RoleClients → `clients.client_id`

**修正**：`client_id` 为 PK，所有 FK 统一引用。

### P0-3: `menus` 表与 `permissions` 表概念重叠

维护了两棵树：
- `permissions` 树（权限管理页面展示）
- `menus` 树（侧边栏导航）

`menus.permission_code` 是松散字符串引用，无 FK 约束。

**修正**：合并 `menus` → `permissions`。`type` 枚举扩展为 `DIRECTORY | PAGE | API | DATA`。有 `path` → 渲染为菜单项，无 `path` → 纯权限点。

### P0-4: `permissions.type` 只是展示标签

三种类型（MENU/API/DATA）共用一套字段，无类型专属约束：
- 全部 43 个种子权限都是 `type='API'`
- `resource`/`action` 对所有类型都可空
- DATA 类型完全不参与数据范围逻辑（由 `role_data_scopes` 独立处理）

**修正**：`type` 作为鉴别列，不同 type 有不同的必填字段组合。PG CHECK 约束 + Zod discriminatedUnion 双重保障。

### P0-5: 关联表使用代理主键

4 张关联表都有独立 `id` PK + unique index on `(fk1, fk2)`，相当于两套唯一约束。

**修正**：`(fk1, fk2)` 直接作为复合主键。

### P1-1: 全库 `text` 类型滥用

- PK/FK 用 `text` 存 UUID → 36B vs 原生 `uuid` 16B，索引效率差 2.25 倍
- 所有字符串列零长度约束
- `ip` 用 `text` 而非 `inet`
- 日志表 `event_type`/`operation` 用 `text` 而非枚举

**修正**：
- PK/FK → `uuid`
- 业务字符串 → `varchar(n)` 加长度约束
- `ip` → `inet`
- 枚举列 → pgEnum

### P1-2: `access_tokens.token` / `refresh_tokens.token` 存明文

存原始 token，且为 nullable unique（语义矛盾）。

**修正**：改为 `token_hash varchar(64)`（SHA256 哈希），不可为空。

### P1-3: 缺少关键列

| 缺失列 | 用户故事 | 说明 |
|--------|---------|------|
| `users.deleted_at` | US-B-11 | 明确要求「数据库设置 `deleted_at` 时间戳」 |
| `users.password_changed_at` | US-SEC-02 | 密码修改后所有设备 JWT 失效 |

### P2-1: `consents` 表无业务支撑

用户故事中无任何授权同意相关场景。企业内部 SSO 不需要 OAuth consent 流程。

**修正**：删除此表，需要时按 OIDC 规范重新添加。

### P2-2: `timestamp` 应统一为 `timestamptz`

无时区的 `timestamp` 在跨时区场景下有歧义。

---

## 三、目标表结构（15 张表）

### 核心实体（5 张）

| 表 | 关键变更 |
|----|---------|
| `users` | uuid PK，varchar 类型，新增 `deleted_at`、`password_changed_at` |
| `departments` | uuid PK，varchar 类型，`ancestors` 物化路径保留 |
| `roles` | uuid PK，varchar 类型 |
| `permissions` | uuid PK，合并 menus 全部功能，type 鉴别联合，varchar + CHECK 约束 |
| `clients` | `client_id` varchar(50) PK，统一 FK 引用目标 |

### 关联表（4 张，全部复合主键）

| 表 | PK |
|----|----|
| `user_roles` | `(user_id, role_id)` |
| `role_permissions` | `(role_id, permission_id)` |
| `role_data_scopes` | `(role_id, dept_id)` |
| `role_clients` | `(role_id, client_id)` |

### OIDC 协议表（3 张）

| 表 | 关键变更 |
|----|---------|
| `authorization_codes` | uuid PK，FK 统一引用 `clients.client_id` |
| `access_tokens` | uuid PK，`token_hash` 替代 `token` |
| `refresh_tokens` | uuid PK，`token_hash` 替代 `token` |

### 基础设施表（3 张）

| 表 | 关键变更 |
|----|---------|
| `jwks` | uuid PK，`kid` varchar(50) |
| `audit_logs` | uuid PK，`operation` 用枚举，`ip` → `inet`，无 FK |
| `login_logs` | uuid PK，`event_type` 用枚举，`ip` → `inet`，无 FK |

### 删除的表（2 张）

| 表 | 原因 |
|----|------|
| `menus` | 合并到 `permissions`（统一权限树） |
| `consents` | 无业务支撑 |

---

## 四、permissions.type 鉴别联合设计

```
type: DIRECTORY | PAGE | API | DATA

列            DIRECTORY    PAGE        API         DATA
─────────────────────────────────────────────────────────
code          ✅ 必填       ✅ 必填      ✅ 必填      ✅ 必填
name          ✅            ✅           ✅           ✅
path          可选          必填         ✗ NULL       ✗ NULL
icon          ○             ○            ✗            ✗
visible       ✅            ✅           ✗            ✗
resource      ✗ NULL        ✗ NULL      必填         必填
action        ✗ NULL        ✗ NULL      必填         必填
client_id     ✗ NULL        ✗ NULL      ○ FK         ✗ NULL
parent_id     可选          可选         可选         可选
```

PG CHECK 约束 + Zod discriminatedUnion 双重保障。

---

## 五、类型映射对照

| 场景 | 旧类型 | 新类型 |
|------|--------|--------|
| PK (UUID) | `text` | `uuid` |
| FK (UUID 引用) | `text` | `uuid` |
| PK (业务键) | `text` | `varchar(50)` |
| username | `text` | `varchar(50)` |
| email | `text` | `varchar(255)` |
| name | `text` | `varchar(100)` |
| code | `text` | `varchar(50)` |
| path | `text` | `varchar(200)` |
| icon | `text` | `varchar(50)` |
| token_hash | — | `varchar(64)` |
| client_secret | `text` | `varchar(128)` |
| scopes | `text` | `varchar(200)` |
| redirect_uris | `text[]` | `varchar(255)[]` |
| ancestors | `text` | `varchar(500)` |
| description | `text` | `text`（保留） |
| ip | `text` | `inet` |
| user_agent | `text` | `varchar(500)` |
| url/homepage_url/logo_url | `text` | `varchar(500)` |
| error_msg/fail_reason | `text` | `text`（保留） |
| public_key/private_key | `text` | `text`（保留） |
| sort | `integer` | `smallint` |
| status (HTTP) | `integer` | `smallint` |
| event_type (login_logs) | `text` | `login_event` 枚举 |
| operation (audit_logs) | `text` | `audit_operation` 枚举 |
| timestamp | `timestamp` | `timestamptz` |

---

## 六、枚举扩展

```sql
-- 新增（替代旧的 permission_type + menu_type）
CREATE TYPE permission_type AS ENUM ('DIRECTORY', 'PAGE', 'API', 'DATA');

-- 新增（替代 login_logs 裸 text）
CREATE TYPE login_event AS ENUM (
  'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT',
  'TOKEN_REFRESH', 'TOKEN_REFRESH_FAILED'
);

-- 新增（替代 audit_logs 裸 text）
CREATE TYPE audit_operation AS ENUM (
  'USER_CREATE', 'USER_UPDATE', 'USER_DELETE', 'USER_ROLE_ASSIGN',
  'ROLE_CREATE', 'ROLE_UPDATE', 'ROLE_DELETE', 'ROLE_PERMISSION_ASSIGN',
  'PERMISSION_CREATE', 'PERMISSION_UPDATE', 'PERMISSION_DELETE',
  'DEPARTMENT_CREATE', 'DEPARTMENT_UPDATE', 'DEPARTMENT_DELETE',
  'CLIENT_CREATE', 'CLIENT_UPDATE', 'CLIENT_DELETE', 'CLIENT_SECRET_REGENERATE',
  'TOKEN_REVOKE'
);

-- 删除（不再需要）
-- DROP TYPE menu_type;
-- 注意：user_status, entity_status, data_scope_type, jwk_algorithm, code_challenge_method 保留不变
```
