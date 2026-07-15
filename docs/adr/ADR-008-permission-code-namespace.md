# ADR-008: 权限码命名空间化模型

| 属性       | 值                                    |
|------------|---------------------------------------|
| **状态**   | accepted                              |
| **日期**   | 2026-07-15                            |
| **决策者** | Auth-SSO 团队                         |
| **影响范围** | permissions 表结构、权限码格式、Seed 数据、合约定义 |

## 背景

当前权限码 `permissions.code` 是全局扁平的（如 `user:list`、`menu:dashboard`），不包含 Client 归属信息。

但在 OAuth 2.1 + RBAC 混合模型中，**Client 是权限的容器**——每个 OAuth Client 在 Portal 中注册后，需要声明自己有哪些 API 权限和页面权限。不同 Client 的权限需要在管理界面中可以区分、在 Redis 中可以按 Client 前缀过滤、在子应用中可以按本地 Client ID 匹配。

## 决策

**权限码 `code` 采用 `{clientId}:{resource}:{action}` 命名空间格式。**

### code 格式

```
{clientId}:{resource}:{action}

示例:
  portal:user:read       — Portal 客户端，用户读权限
  portal:user:create     — Portal 客户端，用户创建权限
  portal:menu:users      — Portal 客户端，用户管理页面
  app-b:order:list       — 第三方 Client B，订单列表权限
  app-b:order:create     — 第三方 Client B，订单创建权限
  app-b:menu:orders      — 第三方 Client B，订单管理页面
```

### 字段变更

| 列 | 当前 | 变更后 |
|----|------|--------|
| `code` | `varchar(50) UNIQUE`，值如 `user:list` | `varchar(150) UNIQUE`，值如 `portal:user:list`（长度扩展） |
| `resource` | `varchar(100)`，从 code 解析 | **删除** — code 已自包含全部信息 |
| `action` | `varchar(50)`，从 code 解析 | **删除** — code 已自包含全部信息 |
| `client_id` | `varchar(50)` FK→clients（API 类型必填） | **保留** — 冗余列，用于 `WHERE client_id = ?` 的索引查询 |

### `resource` / `action` 删除理由

`apps/portal/scripts/seed-rbac.ts:33-42` 中的 `parseResourceAction()` 是从 `code` 字符串拆分出 `resource` 和 `action`，然后写入 DB 以满足 CHECK 约束。这两个字段在运行时鉴权链路中**完全不被使用**（`checkPermission()` 只做 `claims.permissions.includes(code)` 的数组匹配）。它们的存在是循环论证：为了满足自己定义的 CHECK 约束而存在。

### `client_id` 保留理由

虽然 code 前缀已包含 clientId，但管理界面中「列出某 Client 下所有权限」的查询如果用 `WHERE code LIKE 'app-b:%'` 不走索引（前缀模糊匹配）。保留 `client_id` 列可以利用索引加速查询，且它作为外键提供引用完整性。

**不保证 `code` 前缀与 `client_id` 值的一致性**（无 CHECK 约束强制），写入时由应用层保证。`client_id` 被修改时需要应用层同步更新关联 permissions 的 code。

### CHECK 约束变更

```sql
-- 删除旧约束（resource/action 非空检查）
-- type=API 不再强制 resource/action

-- 新约束：仅保留类型特定字段检查
(type IN ('DIRECTORY', 'PAGE') AND resource IS NULL AND action IS NULL AND client_id IS NULL)
OR (type = 'API')  -- API 不再有额外的 NOT NULL 约束
```

### 兼容性

- 所有现有权限码从 `resource:action` 迁移为 `portal:resource:action`
- `ADMIN_ROLE_CODES` 常量不变（角色编码不参与命名空间化）
- `ALL_PERMISSIONS` 常量中所有权限码加 `portal:` 前缀

## 后果

### 正面

- 权限码自描述 Client 归属，不依赖额外字段
- 子应用过滤权限：`permissions.filter(p => p.startsWith('app-b:'))`
- 管理界面按 `client_id` 查询仍走索引
- 废除 `resource`/`action` 冗余列，简化 schema

### 需承担

- 修改 `client_id` 时需级联更新所有权限的 `code`（应用层保证）
- 历史权限码需一次性迁移（seed 脚本 + 已有数据）

## 相关 ADR

- ADR-001: 统一权限树
- ADR-002: 角色-部门绑定
- ADR-007: 子应用自取权限
