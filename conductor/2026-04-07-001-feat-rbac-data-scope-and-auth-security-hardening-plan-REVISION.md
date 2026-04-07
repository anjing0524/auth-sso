# 2026-04-07-001-feat-rbac-data-scope-and-auth-security-hardening-plan-REVISION.md

---
title: RBAC 数据范围与 OIDC 安全加固（修订版）
type: feat
status: active
date: 2026-04-07
origin: conductor/2026-04-03-001-feat-rbac-data-scope-refinement-plan.md
---

# GStack /autoplan Review Report

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAN | Strategy approved. P1 Completeness prioritized. |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | CLEAN | No additional gaps identified. |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | **ISSUES_OPEN** | Type error in `TransactionSql` callback. Missing recursion limits. |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAN | Tree selector recommended for `CUSTOM` scope. |
| DX Review | `/plan-devex-review` | Developer experience gaps | 1 | CLEAN | API documentation required. |

**VERDICT: NOT CLEARED — Eng Review has open issues (type errors).**

---

## Overview

本项目正处于 RBAC 数据范围逻辑完善阶段。经过 GStack `/autoplan` 自动化评审，发现现有代码中存在类型错误（TransactionSql shadowing）以及架构上的潜在风险（无限递归可能）。本修订版计划旨在修复这些阻塞点并完成剩余安全加固。

## Key Findings & Decisions

- **[ARCH] 递归限深**: 为防止部门层级循环导致死循环，在 Recursive CTE 中增加深度计数器（MAX 10）。
- **[ERROR] 容错机制**: 递归查询失败或超时时，回退到“仅限本部门”或“无权访问”，而非系统崩溃。
- **[TYPE] 类型修复**: 修复 `data-scopes/route.ts` 中的 `sql` 变量遮蔽导致的 `TransactionSql` 不可调用错误。
- **[SECURITY] Nonce 校验**: 严格校验 OIDC `id_token` 中的 `nonce` 参数，防止重放攻击。

## Implementation Plan

### Unit 1: Fix Type & Lint Errors (Blocker)
- **File**: `apps/portal/src/app/api/roles/[id]/data-scopes/route.ts`
- **Change**: 将 `sql.begin(async sql => { ... })` 中的内部 `sql` 重命名为 `tx`，修复类型遮蔽问题。
- **File**: `apps/demo-app/package.json`
- **Change**: 修正 `next lint` 脚本路径。

### Unit 2: Recursion Depth Limit & Error Fallback
- **File**: `apps/portal/src/lib/auth-middleware.ts`
- **Change**: 
  - 在 `WITH RECURSIVE` 中加入 `depth` 字段。
  - 增加 `WHERE depth < 10` 过滤。
  - 使用 `try-catch` 包裹查询。

### Unit 3: OIDC Nonce Hardening
- **File**: `apps/portal/src/app/api/auth/callback/route.ts`
- **Change**: 从 Session/Cookie 中提取 `nonce` 并与 `id_token` 校验。

### Unit 4: User Management API Scope Filtering
- **File**: `apps/portal/src/app/api/users/route.ts` (or similar)
- **Change**: 集成 `getDataScopeFilter` 逻辑，确保管理 API 遵循数据范围限制。

### Unit 5: Verification & Testing
- **New Test**: `tests/data-scope.test.js`
- **New Test**: `tests/auth-security.test.js`
- **Command**: `pnpm typecheck && pnpm lint && ./tests/run-tests.sh`

## Verification

- [ ] `pnpm typecheck` 通过（修复 TransactionSql 错误）。
- [ ] `pnpm lint` 通过（修复 demo-app 路径错误）。
- [ ] 自动化测试验证数据范围逻辑（DEPT_AND_SUB, CUSTOM）。
- [ ] 验证 OIDC Nonce 不匹配时登录失败。
