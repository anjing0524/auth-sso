# 2026-04-03-001-feat-rbac-data-scope-refinement-plan.md

---
title: RBAC 数据范围逻辑完善与安全加固
type: feat
status: active
date: 2026-04-03
---

# RBAC 数据范围逻辑完善与安全加固

## Overview

目前系统的 RBAC (基于角色的访问控制) 模型已经建立了基础，但“数据范围” (Data Scope) 逻辑尚未完全实现。`DEPT_AND_SUB` (本部门及子部门) 和 `CUSTOM` (自定义部门) 模式在 `auth-middleware.ts` 中仍为 `TODO`。此外，现有的业务 API (如用户管理) 尚未主动应用数据范围过滤，存在越权访问风险。

本计划旨在补全数据范围的核心逻辑，并对关键 API 进行安全加固。

## Problem Frame

1.  **逻辑缺失**：`checkDataScope` 函数中 `DEPT_AND_SUB` 和 `CUSTOM` 分支未实现。
2.  **管理缺失**：缺乏管理角色自定义数据范围 (Role Data Scopes) 的 API 和 UI。
3.  **API 风险**：用户管理、部门管理等 API 仅校验了操作权限码，未校验数据范围，导致普通管理员可能查看到非授权范围内的数据。

## Requirements Trace

- R1. 实现 `DEPT_AND_SUB` 数据范围判定逻辑。
- R2. 实现 `CUSTOM` 数据范围判定逻辑，支持关联多个部门。
- R3. 提供角色自定义数据范围的管理 API。
- R4. 在用户管理 API 中集成数据范围过滤。
- R5. 在部门管理 API 中集成数据范围过滤。
- R6. (可选) 前端支持自定义数据范围的部门选择。

## Scope Boundaries

- **非目标**：本计划不涉及 ABAC (基于属性的访问控制)。
- **非目标**：不涉及跨应用的数据隔离（目前所有应用共享同一套 RBAC）。

## Context & Research

### Relevant Code and Patterns

- `apps/portal/src/lib/auth-middleware.ts`: 权限校验核心中间件。
- `apps/portal/src/lib/permissions.ts`: 权限上下文获取逻辑。
- `apps/portal/src/app/api/users/route.ts`: 用户管理 API 示例。
- `apps/idp/src/db/schema/index.ts`: 数据库 Schema 定义 (Drizzle)。

### Institutional Learnings

- `数据库表结构草案-auth-sso-v1.0.md`: 明确了 `role_data_scopes` 表的结构和 `departments` 表的 `parent_id` 关系。

## Key Technical Decisions

- **递归查询方案**: 由于 `departments` 表目前没有 `ancestors` 字段，我们将使用 PostgreSQL 的 **Recursive CTE** (公共表表达式) 来实现 `DEPT_AND_SUB` 的层级查询。
- **过滤方式**: 在 API 层级，通过 `withDataScopeFilter` 辅助函数生成 SQL 过滤条件，而不是在内存中过滤，以保证性能。

## Open Questions

### Resolved During Planning

- **CUSTOM 逻辑依据**: 确定使用 `role_data_scopes` 表来记录角色与自定义部门的映射。
- **最高权限优先**: 如果用户有多个角色，数据范围取最 permissive 的模式 (Order: ALL > DEPT_AND_SUB > DEPT > CUSTOM > SELF)。

### Deferred to Implementation

- **前端树形选择器**: 前端 UI 是否在本阶段完整实现，取决于 UI 组件库对树形选择的支持程度。

## Implementation Units

- [x] **Unit 1: 补全 auth-middleware.ts 数据范围逻辑**

**Goal:** 实现 `checkDataScope` 中的 `DEPT_AND_SUB` 和 `CUSTOM` 逻辑。 (经核实，代码中已通过 Recursive CTE 实现)

**Files:**
- Modify: `apps/portal/src/lib/auth-middleware.ts`

**Approach:**
- `DEPT_AND_SUB`: 编写递归 SQL 查询当前用户所属部门的所有子部门 ID。
- `CUSTOM`: 查询 `role_data_scopes` 表中与用户角色关联的部门 ID。

**Test scenarios:**
- Happy path: `DEPT_AND_SUB` 能正确识别下级部门。
- Happy path: `CUSTOM` 能正确识别绑定的多个部门。
- Edge case: 部门层级循环引用（虽然数据库约束应避免，但逻辑应健壮）。

- [x] **Unit 2: 角色自定义数据范围管理 API**

**Goal:** 提供管理角色与部门关联的接口。 已完成 API 实现。

**Files:**
- Create: `apps/portal/src/app/api/roles/[id]/data-scopes/route.ts`

**Approach:**
- `GET`: 获取指定角色关联的部门 ID 列表。
- `POST`: 更新角色关联的部门列表（先删后增）。

**Test scenarios:**
- Happy path: 正常保存和读取自定义部门。
- Error path: 为不存在的角色设置数据范围。

- [x] **Unit 3: 用户管理 API 安全加固**

**Goal:** 在 `GET /api/users` 中应用数据范围过滤。 已完成集成与校验。

**Files:**
- Modify: `apps/portal/src/app/api/users/route.ts`

**Approach:**
- 调用 `getDataScopeFilter` 获取允许的 `deptIds`。
- 如果不是 `ALL` 范围，在 SQL 查询中追加 `dept_id IN (...)` 约束。

**Test scenarios:**
- Happy path: `DEPT` 角色只能看到本部门用户。
- Happy path: `SELF` 角色只能看到自己。

- [ ] **Unit 4: 部门管理 API 安全加固**

**Goal:** 限制用户只能看到其权限范围内的部门。

**Files:**
- Modify: `apps/portal/src/app/api/departments/route.ts`

**Approach:**
- 类似于用户管理，对 `GET /api/departments` 进行过滤。

**Test scenarios:**
- Happy path: `DEPT_AND_SUB` 角色只能看到本部门及其子部门。

- [ ] **Unit 5: 自动化测试验证**

**Goal:** 编写集成测试确保数据范围逻辑生效。

**Files:**
- Create: `tests/data-scope.test.js`

**Approach:**
- 创建不同数据范围的角色。
- 分配给测试用户。
- 调用 API 验证返回数据的正确性。

## System-Wide Impact

- **Performance**: 递归查询在大规模部门树下可能有性能影响，考虑在 `getUserPermissionContext` 中缓存结果。
- **User Experience**: 如果用户被限制了数据范围，前端页面应相应屏蔽无法访问的筛选选项。

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| 递归查询性能风险 | 初始版本限制递归深度或使用索引优化。 |
| 自定义范围逻辑复杂 | 保持 `CUSTOM` 逻辑简单，仅支持部门层级的白名单。 |

## Sources & References

- `数据库表结构草案-auth-sso-v1.0.md`
- `PRD-auth-sso-v1.0.md`
- `apps/portal/src/lib/auth-middleware.ts`
