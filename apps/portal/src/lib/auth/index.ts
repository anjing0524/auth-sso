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
// withScopedWrite，读路径用 scopeFilter / resolveScope（见 ADR-014）。
// 仅保留 requireDeptAccess —— 它是 executor-first 的，且 Server Action 侧
// 16 处调用全部正确（迁移到 withScopedWrite 是后续步骤）。
export { requireDeptAccess } from './data-scope';
export { logServerDataRead } from './server-logger';
export type { PermissionCheckOptions, PermissionCheckResult } from './check-permission';
export { requirePermission } from './check-permission';
export { resolveIdentity, type ResolvedIdentity } from './verify-jwt';
