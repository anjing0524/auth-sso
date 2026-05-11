<!-- /autoplan restore point: /Users/liushuo/.gstack/projects/anjing0524-auth-sso/main-autoplan-restore-20260417-155443.md -->
# 2026-04-17-001-align-req-design-code-test.md

---
title: 对齐 需求、设计、代码与测试 (Static Verification & Direct Fixes)
type: feat
status: draft
date: 2026-04-17
---

## Objective
对齐项目的四大基石：需求（PRD）、设计（DESIGN.md）、代码实现与测试用例，确保核心功能（SSO、RBAC、数据范围、OIDC 安全）的连贯性和一致性。任何缺失的实现或测试将直接在本计划中修复。

## Background & Motivation
项目已进入稳定期，但可能存在需求遗漏、设计未完全落地或测试用例未能覆盖核心业务逻辑的情况。通过静态核对和直接修复，消除各环节间的断层，确保产品质量。

## Scope & Impact
*   **需求层 (PRD.md)**: 检查 SSO 流程、RBAC 权限和数据范围定义。
*   **设计层 (DESIGN.md)**: 核对主色调 (`#0066FF`)、字体 (`Geist`)、圆角、组件状态是否在 UI 中正确使用。
*   **代码层 (Code)**: 确保所有核心逻辑和设计规范均已编码实现。
*   **测试层 (Tests)**: 验证所有核心功能是否都有对应的单元或集成测试。

## Proposed Solution (Static Verification & Direct Fixes)
采取手动审计与即时修复相结合的策略，针对核心功能进行端到端（End-to-End）检查：
1.  **需求与代码对齐**: 验证代码中是否完整实现了 `PRD.md` 中定义的 5 种数据范围（`ALL`, `DEPT`, `DEPT_AND_SUB`, `SELF`, `CUSTOM`）。
2.  **设计与代码对齐**: 检索代码中的 CSS 变量，确保未使用废弃或未定义的颜色/字体（反 AI 模板规则检查）。
3.  **需求与测试对齐**: 检查 `tests/data-scope.test.js` 和 `tests/auth-security.test.js`，确保覆盖 OIDC Nonce 和所有数据范围组合。
4.  **修复遗漏**: 如果发现某功能有需求但无测试，或有设计但代码未遵守，则直接提交补丁（如补充 `CUSTOM` 数据范围的实现或测试）。

## Alternatives Considered
*   **Automated Traceability Scripts**: 编写脚本解析文档和代码 AST。优点是可复用，缺点是前期投入过大，适合长期维护的超大型项目。
*   **Audit & Issue Generation**: 仅审计并生成 GitHub Issues。优点是不干扰当前开发，缺点是无法立即解决现有不一致问题，可能导致技术债堆积。

## Implementation Steps
### Phase 1: 审计核心功能对齐状态
*   **Step 1**: 审查 `apps/portal/src/app/api/users/route.ts` 和相关中间件，确认数据范围过滤逻辑的完整性。
*   **Step 2**: 检索 `apps/portal/src/app/globals.css` 等样式文件，检查是否严格遵循 `DESIGN.md` 中定义的主题配置。
*   **Step 3**: 分析现有测试集（`tests/*.test.js`），构建功能与测试的映射矩阵，找出缺失项。

### Phase 2: 直接修复断层
*   **Step 1 (代码修复)**: 修复未遵循设计规范的 UI 组件或补齐缺失的权限拦截逻辑。
*   **Step 2 (测试补充)**: 为遗漏的核心路径（如边界条件、异常流）编写测试用例。

## Verification
*   所有新加及现有测试运行通过 (`pnpm test`)。
*   `pnpm lint` 和 `pnpm typecheck` 零报错。
*   提供最终的对齐报告矩阵，确认 100% 覆盖。

## Migration & Rollback
*   所有修复将以原子的 commit 提交。若修复导致回归，可基于 Git History 随时回滚到本计划执行前的节点。
