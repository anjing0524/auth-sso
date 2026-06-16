/**
 * OAuth 授权准入检查（纯函数，独立于 HTTP/DB）
 * 从 oauth2/authorize/route.ts 提取，便于单元测试
 *
 * @module domain/shared/oauth-authorize-check
 */

export interface AuthorizationInput {
  userId: string;
  clientId: string;
  roles: Array<{ id: string; code: string; status: string }>;
  roleClients?: Array<{ roleId: string; clientId: string }>;
}

export interface AuthorizationResult {
  allowed: boolean;
  errorCode?: 'unauthorized_client' | 'no_roles';
  message?: string;
}

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'ADMIN']);

/**
 * 检查用户是否有权访问指定的 OAuth Client
 *
 * 逻辑链路：
 *   1. 筛选 ACTIVE 角色
 *   2. 管理员角色（SUPER_ADMIN / ADMIN）直接放行
 *   3. 非管理员需通过 roleClients 绑定检查
 *   4. 无任何角色则拒绝
 */
export function checkUserClientAccess(input: AuthorizationInput): AuthorizationResult {
  const { clientId, roles, roleClients = [] } = input;

  const activeRoles = roles.filter(r => r.status === 'ACTIVE');
  const activeRoleIds = new Set(activeRoles.map(r => r.id));

  if (activeRoles.length === 0) {
    return { allowed: false, errorCode: 'no_roles', message: '您的账号尚未分配任何有效角色，无法访问系统。' };
  }

  const isAdmin = activeRoles.some(r => ADMIN_ROLES.has(r.code));
  if (isAdmin) {
    return { allowed: true };
  }

  const hasClientBinding = roleClients.some(
    rc => activeRoleIds.has(rc.roleId) && rc.clientId === clientId,
  );

  if (!hasClientBinding) {
    return { allowed: false, errorCode: 'unauthorized_client', message: '您没有访问该系统的权限，请联系管理员分配。' };
  }

  return { allowed: true };
}
