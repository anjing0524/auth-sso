# TODOS.md — Auth-SSO 待办项跟踪

> 最后更新：2026-06-26

---

## 已完成 ✅（本次会话：25 项）

- [x] UserTable 硬编码 slate 令牌 — 13+ 处 → design token
- [x] Dashboard 硬编码绿色/蓝色 — 6 处 → text-success/bg-success/text-info
- [x] CommandPalette 图标渲染 — ICON_MAP + 递归 flatMap + 字母排序
- [x] TODOS.md 创建
- [x] 按钮圆角全局统一 — 13 文件 → rounded-lg (8px)
- [x] 操作按钮尺寸统一 — h-8 w-8 (32px)
- [x] DESIGN.md 补充表格规范 — DataTable + 按钮规范 + 分页器
- [x] CreateUserDialog 默认密码 — password123 → 空
- [x] 审计日志 EVENT_TYPE_COLORS — hex → design token
- [x] A5: UserDetailForm 角色分配 — 集成 AssignRoleDialog
- [x] UserDetailForm 硬编码颜色 — 20+ 处 → design token
- [x] users/new、clients/new 表单统一 — 圆角 + 颜色
- [x] A7: Refresh 端点优化 — 验证已实现 (REFRESH_THRESHOLD=5min)
- [x] API.md v2.0 — 区分 REST vs Server Action，移除虚假端点
- [x] USER_STORIES.md v3.3 — §19 矩阵对齐新 API.md
- [x] Dashboard deptId 安全 — 验证非问题 (Server Component + cookies)
- [x] 审计日志 overflow-x-auto — 窄屏横向滚动
- [x] 暗黑模式兼容 — 8 文件批量修复
- [x] ClientsTable — 8 处 token 修复
- [x] UserFilters — 3 处 token 修复
- [x] AssignRoleDialog — 4 处 token 修复
- [x] DepartmentTree — token 修复
- [x] ClientInfoSection / ClientTokensSection — token 修复
- [x] Cmd+K 排序 — 字母序 (zh-CN localeCompare)
- [x] EmptyState onboarding — 4 步骤已正确定义，无需修改

---

## 产品路线图（独立规划，非阻塞性任务）

以下为 P3 级产品功能，需独立需求和设计文档，不在本次会话范围内：

- SCIM 配置（企业 SSO 准入门槛）
- SIEM 审计日志导出（Splunk/Datadog/Sentinel）
- WCAG 2.1 AA 合规审核（键盘导航、对比度、触摸目标）
- 侧边栏导航重构（角色+权限 → 权限中心子菜单）
- 租户品牌自定义框架（登录页渐变可配置化）
- E1: 遥测基础（需确定存储后端 + 事件 schema + 隐私策略）
