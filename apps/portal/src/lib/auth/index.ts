/**
 * Auth 模块统一入口 (Public Barrel)
 *
 * 使用建议：
 * - Server Action 鉴权 → import { withAuth } from '@/lib/auth'
 * - API Route 鉴权   → import { withPermission } from '@/lib/auth'
 * - 身份验证         → import { resolveIdentity } from '@/lib/auth'
 * - 权限检查         → import { checkPermission, isSuperAdmin } from '@/lib/auth'
 * - 数据范围         → import { getDataScopeFilter, applyDataScopeFilter } from '@/lib/auth'
 * - 浏览器端 OAuth   → import { oauthConfig, generateCodeChallenge } from '@/lib/auth/client'
 *
 * @module lib/auth
 */
export { withAuth, type AuthContext } from './guard';
export {
  withPermission,
  checkPermission,
  isSuperAdmin,
  checkDataScope,
  getDataScopeFilter,
  applyDataScopeFilter,
} from './facade';
export type { PermissionCheckOptions, PermissionCheckResult } from './check-permission';
export { resolveIdentity, type ResolvedIdentity } from './verify-jwt';
