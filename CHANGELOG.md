# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- 多 upstream 路由表（`[[upstreams]]`），支持按路径前缀将请求路由到不同上游应用
- 启动期 `validate_routing_consistency()` 路由一致性校验，检测路径前缀交叉覆盖、上下游不一致等配置错误

### Changed
- `[portal].public_paths` 语义收窄为全局白名单——仅保留登录/注册/认证等全局必须公开端点；各应用独立的公开路径移至 `[[upstreams]].public_paths`
- Docker 配置文件 `gateway.docker.toml` 对齐生产配置结构，Portal upstream 条目新增 `public_paths`

### Security
- 零信任身份头剥离策略从精确匹配 4 个头强化为黑名单兜底——无条件剥离所有 `X-*` 头（仅显式放行 `X-Forwarded-*` / `X-Request-Id` / `X-Correlation-Id` / `X-Real-IP`）。下游收到的身份信息 100% 来自 Gateway 权威注入，杜绝客户端伪造透传

## [1.1.1.1] - 2026-06-26

### Fixed
- **CreateUserDialog 硬编码颜色修复**：8 处 `text-slate-*`/`bg-slate-50` → oklch design tokens（`text-foreground`/`text-muted-foreground`/`bg-muted`），暗黑模式兼容
- **Dashboard hex 颜色泄漏修复**：4 处 `hover:bg-[#E6F0FF]` → `hover:bg-primary-subtle`、图标硬编码色 → `text-primary`、status badge 增加暗黑模式支持、audit table `bg-slate-*` → `bg-muted`
- **DataTable 表头 token 泄漏**：`bg-slate-50/30` → `bg-muted/50`
- **UserTable 圆角残值**：`rounded-b-[1.5rem]` → `rounded-b-xl`
- **审计日志 error.tsx token 泄漏**：`bg-amber-50`/`text-amber-500` → `bg-warning/10`/`text-warning`
- **PermissionsTable 搜索 URL 同步**：客户端过滤 → URL searchParams 同步（对齐 RolesTable 模式），搜索状态支持刷新恢复

### Added
- **5 个 Dashboard 页面 error boundaries**：Dashboard/Roles/Permissions/Users/Clients 均添加 error.tsx，防止数据获取失败白屏
- **4 个组件测试文件**：EmptyState (7 用例)、DataTable (5 用例)、CommandPalette (3 用例)、AuditLogs (3 用例)，全部通过

### Changed
- **DESIGN.md v2.2**：颜色体系全量迁移至 oklch，hex 色值表替换为 oklch 值 + Token 引用，圆角系统扩增 `rounded-2xl` (16px)
- **autoplan 审查报告**：plan 文件更新 CEO+Design+Eng 三轮审查结果

## [1.1.1.0] - 2026-06-25

### Added
- **EmptyState 组件**：统一的空状态展示（simple + onboarding 双变体），集成到 DataTable，替代各页面内联纯文字空状态
- **Command Palette (Cmd+K)**：全局命令面板，200ms debounce 防双击闪烁，搜索菜单项并快速跳转
- **审计日志页错误/加载边界**：error.tsx + loading.tsx，首次使用引导 Checklist（Dashboard users=0 时显示）
- **Playwright 视觉回归测试**：登录页、Dashboard、用户列表、审计日志的快照比对

### Changed
- **CSS 颜色体系统一为 oklch**：删除 hex `--color-*` 变量层，全部颜色值转为 oklch，保留 var() 间接引用确保暗黑模式正常，shadcn `--primary` 前景色语义不变
- **登录页品牌渐变背景**：bg-slate-50 → `bg-gradient-to-br from-[var(--color-gradient-start)] to-[var(--color-gradient-end)]`，对齐 DESIGN.md
- **DataTable 迁移**：激活死代码共享组件，4 个表格式列表页（角色/权限/用户/应用）统一使用 DataTable
- **审计日志页全面重建**：原生 HTML table → shadcn Table + 设计 Token + 暗黑模式（EVENT_TYPE_COLORS 徽章）
- **全站圆角收敛**：rounded-[1.25rem/1.5rem/2rem] 等任意值 → 规范值 6/8/12/16px（~25 文件）
- **页面标题统一**：所有 CRUD 页标题使用图标 + 粗体 + 副标题格式
- **CreateUserDrawer → CreateUserDialog**：操作入口统一为 Dialog（简单表单），废弃 Sheet

### Removed
- Dashboard 装饰性模糊圆形 blob
- 侧边栏无用搜索框（Cmd+K 为唯一搜索入口）

### Fixed
- **ClientsTable toast 反馈补全**：删除操作后显示 sonner toast 通知
- **UserTable 圆角收敛**：残留的 rounded-[1.5rem] → rounded-xl

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
