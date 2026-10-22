/**
 * Auth 模块统一入口 (Public Barrel)
 *
 * 已去除 Better Auth 依赖，全部基于 JWT Cookie 无状态架构。
 *
 * 使用建议：
 * - Server Action 鉴权 → import { withAuth } from '@/lib/auth'
 * - API Route 鉴权   → import { withPermission } from '@/lib/auth'
 * - 身份验证         → import { resolveIdentity } from '@/lib/auth'
 * - 权限检查         → import { checkPermission } from '@/lib/auth'
 *
 * @module lib/auth
 */
export { withAuth, withPermission, type AuthContext } from './guard';
export { checkPermission } from './check-permission';
// 数据范围（OBAC）原语**不再对外导出**：范围快照的获取与使用必须绑定同一执行器，
// 否则会出现"事务外取快照、事务内复用"的 TOCTOU。写路径用 @/lib/authz 的
// withScopedWrite / withScopedRow，读路径用 scopeFilter / resolveScope（见 ADR-014）。
// `requireDeptAccess` 曾作为过渡期唯一保留的导出；其调用点已全部迁移到
// `withScopedWrite` / `withScopedRow`（实测 0 处调用），故一并撤下。
export { logServerDataRead } from './server-logger';
export type { PermissionCheckOptions, PermissionCheckResult } from './check-permission';
export { requirePermission } from './check-permission';
export { resolveIdentity, type ResolvedIdentity } from './verify-jwt';
