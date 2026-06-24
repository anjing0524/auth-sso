# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0.1] - 2026-06-24

### Changed
- **文档体系重构**：`docs/spec/` 重组为 7 份产品交付文档（PRD / 架构设计 / 架构约束 / API 设计 / 数据库设计 / 需求矩阵 / 用户故事）
- ARCHITECTURE.md 升级至 v5.0，完全对齐实际代码实现（纯自定义 JWT + jose，Portal 即 OIDC Provider）
- 新增 ARCHITECTURE_CONSTRAINTS.md（13 条核心约束 + 红线检查清单 + Controller 骨架）
- PRD.md 升级至 v1.1，清理独立 IdP 引用
- DATABASE.md 升级至 v3.1，吸收 4 份历史数据库审查文档的关键结论

### Removed
- TDD-MASTER-PLAN.md（过时，已被 REQUIREMENTS_MATRIX.md 覆盖）
- DATABASE-DBA-REVIEW.md / DATABASE-DRIZZLE-AUDIT.md / DATABASE_FIX_PLAN.md / DATABASE_REDESIGN.md（合并至 DATABASE.md）

### Fixed
- CLAUDE.md 修正 Session 架构描述（Better Auth → 纯自定义 JWT）
- packages/config/env.ts 修正架构注释（Better Auth → jose）
- README.md 清理 Better Auth 引用，更新文档索引

## [1.1.0.0] - 2026-06-23

### Added
- 登出增加四层撤销闭环：Access Token JTI 黑名单 + Login Session JTI 黑名单 + Refresh Token DB 标记 + 按用户撤销全部 Refresh Token
- 权限注册接口支持 `path`/`icon`/`visible` 字段，支持 DIRECTORY/PAGE 类型菜单注册
- Portal 菜单种子数据（dashboard、users、roles、permissions、departments、clients、audit-logs）
- 审计日志 IP 字段改为 PostgreSQL `inet` 类型，新增 `sanitizeIp` 输入清洗
- 仪表板 error.tsx / loading.tsx 边界组件
- ProfileClient 客户端组件（个人资料页重构）
- 新增 auth login/logout API 测试（12 个用例）

### Changed
- 数据库 Schema 系统性重建（v2）：
  - 所有主键统一为 `uuid` + `gen_random_uuid()`
  - 时间列从 `timestamp` 迁移到 `timestamptz`
  - 有界字符串从 `text` 迁移到 `varchar(n)`
  - Access/Refresh Token 列重命名为 `token_hash`（预 SHA256 哈希化）
  - FK 统一引用 `clients.client_id`（消除 `id`/`public_id`/`client_id` 三标识符冗余）
- 菜单模块合并进权限模块：`menus` 表移除，新增 `DIRECTORY | PAGE | API | DATA` 四种权限类型，`permissions` 表增加 CHECK 约束
- 审计日志 `eventType` 和 `operation` 从裸 text 改为 PostgreSQL 原生枚举
- `requirePermission` 合并进 `check-permission.ts`，新增运行时断言守卫
- Next.js 16 `revalidateTag` 双参签名适配 → `updateTag`
- CI Node.js 版本提升至 >=26（Temporal API 默认可用）

### Removed
- `consents` 表（无业务支撑）
- `menus` 表及关联路由、domain、actions（已合并进 permissions）
- `public_id` 列（所有实体改用 UUID 主键）
- 3 个冗余左前缀索引（rolePermissions、roleDataScopes、roleClients）

### Fixed
- seed-rbac.ts 复合主键写入修复（移除独立 `id` 列）
- 批量为 PATCH/MICRO 版本修复项（测试对齐 v2 schema、USER_STORIES 过期引用等）

## [1.0.0.1] - 2026-05-11

### Added
- New `pnpm infra:up` script to start Docker infrastructure easily.
- Role management page now has friendly Empty States and Loading skeletons.

### Changed
- Improved local testing stability by disabling proxy for internal service calls.
- Switched to `is_background: true` for local service orchestration.

### Fixed
- Resolved connection refused errors in TDD test suite.
