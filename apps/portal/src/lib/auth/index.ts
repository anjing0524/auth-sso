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
 * - 数据范围         → import { getUserRoleDeptIds } from '@/lib/auth'
 *
 * @module lib/auth
 */
export { withAuth, type AuthContext } from './guard';
export {
  withPermission,
  checkPermission,
  getUserRoleDeptIds,
  canAccessDept,
} from './facade';
export type { PermissionCheckOptions, PermissionCheckResult } from './check-permission';
export { requirePermission } from './check-permission';
export { resolveIdentity, type ResolvedIdentity } from './verify-jwt';
