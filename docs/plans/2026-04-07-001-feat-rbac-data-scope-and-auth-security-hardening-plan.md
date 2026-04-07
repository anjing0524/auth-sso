---
title: RBAC 数据范围补全与认证安全加固
type: feat
status: active
date: 2026-04-07
origin: conductor/2026-04-03-001-feat-rbac-data-scope-refinement-plan.md
---

# RBAC 数据范围补全与认证安全加固

## Overview

本计划旨在解决当前权限系统中的三大核心问题：
1. **数据范围管理缺失**：补全 `role_data_scopes` 的管理 API，使 `CUSTOM` 数据范围模式可用。
2. **API 数据范围绕过风险**：在用户管理 API 中集成数据范围过滤，防止越权访问。
3. **OIDC 安全漏洞**：在 OAuth2/OIDC 回调流程中强制校验 `id_token` 的 `nonce` 声明，防范重放攻击。

## Problem Frame

1.  **逻辑缺失**：虽然 `auth-middleware.ts` 实现了 `DEPT_AND_SUB` 和 `CUSTOM` 判定，但由于缺乏管理界面和 API，`CUSTOM` 实际上无法配置。
2.  **过滤漏洞**：`/api/users` 等管理接口仅校验了 `user:list` 权限，未根据请求者的 `dataScopeType` 限制返回的数据行。
3.  **安全隐患**：认证回调中存储了 `nonce` 但未与 `id_token` 校验，不符合 OIDC 安全规范。

## Requirements Trace

- R1. 验证 `DEPT_AND_SUB` 递归查询逻辑的正确性。(Todo #001)
- R2. 实现角色自定义数据范围的管理 API (GET/POST/DELETE)。(Todo #002)
- R3. 在用户管理 API (`/api/users`) 中集成 `getDataScopeFilter`。(Todo #003)
- R4. 在认证回调中实现 `id_token` 的 `nonce` 校验。(Todo #005)

## Scope Boundaries

- **非目标**：本计划暂不涉及前端管理页面的开发。
- **非目标**：暂不重构 `auth-middleware.ts` 的核心结构。

## Context & Research

### Relevant Code and Patterns

- `apps/portal/src/lib/auth-middleware.ts`: 包含 `checkDataScope` 和 `getDataScopeFilter`。
- `apps/portal/src/app/api/auth/callback/route.ts`: OAuth 回调处理逻辑。
- `apps/idp/src/db/schema/index.ts`: 数据库表结构定义。
- `apps/portal/src/app/api/users/route.ts`: 需要加固的用户列表 API。

## Key Technical Decisions

- **API 路径选择**：角色数据范围 API 路径定为 `/api/roles/[id]/data-scopes`，符合 RESTful 规范。
- **数据范围过滤**：使用 `getDataScopeFilter` 返回的 `deptIds` 列表，在 SQL 查询中通过 `dept_id IN ${sql(deptIds)}` 进行过滤。如果类型为 `ALL`，则跳过过滤。
- **Nonce 校验位置**：在 `id_token` 解析后、创建 Session 前进行严格比对。

## Implementation Units

- [x] **Unit 1: 验证并更新 RBAC 逻辑状态**
  - **Goal:** 确认 `DEPT_AND_SUB` 和 `CUSTOM` 逻辑在 `auth-middleware.ts` 中已正确实现，并同步文档。
  - **Files:** `apps/portal/src/lib/auth-middleware.ts`, `conductor/2026-04-03-001-feat-rbac-data-scope-refinement-plan.md`
  - **Verification:** 已核实代码实现，符合预期。


- [x] **Unit 2: 实现角色数据范围管理 API**
  - **Goal:** 提供管理 `role_data_scopes` 表的接口。
  - **Files:**
    - Create: `apps/portal/src/app/api/roles/[id]/data-scopes/route.ts`
  - **Approach:** 实现 GET (查询角色关联部门), POST (添加关联), DELETE (移除关联) 方法。已完成 API 实现。
  - **Test scenarios:**
    - Happy path: 正常添加和删除部门关联。
    - Edge case: 尝试为不存在的角色添加数据范围。
    - Error path: 无管理员权限尝试调用。

- [x] **Unit 3: 用户管理 API 集成数据范围过滤**
  - **Goal:** 防止管理员查看到其管辖范围外的用户。
  - **Files:** `apps/portal/src/app/api/users/route.ts`
  - **Approach:** 在 `GET` 处理函数中调用 `getDataScopeFilter(userId)`，根据返回结果动态构建 SQL 条件。已完成集成与校验。
  - **Test scenarios:**
    - Happy path: 部门管理员只能查看到本部门（及子部门）的用户。
    - Happy path: 超级管理员（ALL）能看到所有用户。

- [x] **Unit 4: OIDC Nonce 校验实现**
  - **Goal:** 补全安全检查漏洞。
  - **Files:** `apps/portal/src/app/api/auth/callback/route.ts`
  - **Approach:** 从 `tokens.id_token` 中解析出 `nonce`，并与 `stateData.nonce` 进行比对，不一致则报错。已完成校验逻辑实现。
  - **Test scenarios:**
    - Happy path: 正常登录流程校验通过。
    - Error path: Nonce 不一致导致重定向到登录页并报错。

## System-Wide Impact

- **安全性增强**：显著降低越权访问和重放攻击风险。
- **API 契约**：新增了一个管理接口，需通知前端对接。

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| 递归查询性能风险 | 部门层级通常不深，Recursive CTE 性能可控，且 API 存在分页。 |
| Nonce 校验导致旧 Session 兼容性问题 | 该校验仅影响新登录流程，不影响存量 Session。 |

## Sources & References

- **Origin document:** `conductor/2026-04-03-001-feat-rbac-data-scope-refinement-plan.md`
- Related code: `apps/portal/src/lib/auth-middleware.ts`
