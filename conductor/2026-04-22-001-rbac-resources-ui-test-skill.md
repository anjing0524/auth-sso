# 2026-04-22-001-rbac-resources-ui-test-skill.md

---
title: 完善 RBAC 资源管控并构建 UI 自动化测试验证体系
type: feat
status: draft
date: 2026-04-22
---

## Objective
1. **RBAC 资源管控**：在现有的 RBAC 模型和数据范围基础上，补充细粒度的资源管控，包括 API 权限、菜单权限以及客户端（OAuth 子应用）访问权限。
2. **UI 自动化验证**：创建一个名为 `ui-tester` 的专属 Skill，通过真实浏览器驱动，按需求编号执行端到端测试，保留截图，并最终利用大模型的视觉能力读取截图，分析并出具功能完整性报告。

## Background & Motivation
当前的系统已经实现了基本的角色和数据范围控制，但 `type='MENU'` 的菜单并未在 `api/me/route.ts` 中被真正过滤，且缺乏对不同子系统（客户端）的访问控制。同时，缺乏一种所见即所得的自动化回归机制。通过构建自动化截图分析工具，不仅能覆盖回归测试，还能确保最终的 UI 完全对齐原始需求（PRD/Test Cases）。

## Scope & Impact
*   **Database**: 新增 `role_clients` 表用于客户端权限关联；可能需要优化 `menus` 与 `permissions` 表的映射。
*   **Apps/IdP**: 在 OIDC 的 `/authorize` 阶段拦截无权访问该 Client 的用户。
*   **Apps/Portal**: 更新 `/api/me/route.ts` 以真正基于用户权限过滤侧边栏菜单；在角色管理页面增加 API、菜单、客户端的分配界面。
*   **Skills**: 在 `.gemini/skills/ui-tester/SKILL.md` 新增自动化测试技能。

## Proposed Solution
### 1. 资源管控深入
*   **API 权限**：基于现有的 `permissions` 表（`type='API'`），在管理后台补充完整的增删改查及角色分配 UI。现有的 `checkPermission` 中间件无需大改。
*   **菜单权限**：基于现有的 `permissions` 表（`type='MENU'`）和 `menus` 表，为菜单关联一个 `permission_code`。在 Portal 获取当前用户信息时，递归剔除无权限的节点。
*   **客户端权限**：新增 `role_clients` 表。当用户在 IdP 发起登录请求（授权码模式第一步）时，系统检查该用户的角色列表是否包含请求的 `client_id`。若无权限，则在 IdP 提示“无权访问该子系统”。

### 2. UI 测试 Skill (`ui-tester`)
*   **输入**：读取 `docs/test-cases.md` 中的测试项及编号（如 AUTH-001）。
*   **执行**：Skill 内部调用 `agent-browser` 工具或 MCP 浏览工具打开实际页面（如 localhost:4000），执行输入和点击动作。
*   **输出**：在特定操作节点截取全屏，存入 `tests/screenshots/{编号}_xxx.png`。
*   **分析**：全部执行完毕后，Skill 会读取所有截图文件，结合需求描述，判断 UI 是否完整实现了所需元素，最终生成 Markdown 格式的完整性分析报告。

## Implementation Steps
### Phase 1: 数据库与基础服务端实现
*   **Step 1**: 更新 Drizzle schema，增加 `role_clients` 表，并生成/运行 migration。
*   **Step 2**: 修改 `apps/idp/src/app/api/auth/oauth2/authorize/route.ts`，增加基于客户端授权的拦截逻辑。
*   **Step 3**: 完善 `apps/portal/src/app/api/me/route.ts` 的 `getDynamicMenus` 函数，使其真正受控。

### Phase 2: 管理后台界面开发 (Portal)
*   **Step 1**: 在角色管理表单中，添加资源分配页签：可勾选拥有的 API、菜单节点，以及可访问的接入客户端。
*   **Step 2**: 完善资源管理本身的列表页（菜单管理、API 管理）。

### Phase 3: 创建 `ui-tester` Skill
*   **Step 1**: 在 `.gemini/skills/ui-tester/SKILL.md` 中编写 Skill 逻辑，定义其如何读取用例并驱动浏览器。
*   **Step 2**: 定义截图的收集策略与视觉大模型的 Prompt 分析范式。

### Phase 4: 执行真实测试并验证
*   **Step 1**: 启动所有后端服务和前端服务。
*   **Step 2**: 运行新创建的 `ui-tester` 技能，观察截图结果。
*   **Step 3**: 输出并审核最终的完整性分析报告。

## Verification
*   在 IdP 尝试访问未授权的 `client_id` 时应被明确拒绝。
*   不同的测试角色登录 Portal 时，侧边栏应正确删减选项。
*   `tests/screenshots/` 目录下应包含与测试用例编号一一对应的所有截图，且报告内容客观反映实现状态。

## Migration & Rollback
*   通过 Drizzle 提交原子的 Migration。
*   若遇到阻塞问题，随时回滚数据库结构并回退代码即可。
