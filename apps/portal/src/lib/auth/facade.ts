import 'server-only';

/**
 * 鉴权统一 re-export 入口
 *
 * 子模块职责：
 * - `./verify-jwt`           身份验证（"你是谁"）
 * - `./check-permission`     权限/角色检查（"你能做什么"）
 * - `./data-scope`           数据范围过滤（"你能看哪些数据"）
 * - `./server-logger`        底层数据读取访问日志
 * - `./guard`                withAuth / withPermission 鉴权包装器
 */

export {
  checkPermission,
  type PermissionCheckOptions,
  type PermissionCheckResult,
} from './check-permission';
export {
  getUserRoleDeptIds,
  canAccessDept,
} from './data-scope';
export { logServerDataRead } from './server-logger';
