/**
 * OAuth 2.1 授权准入检查（领域纯函数）
 *
 * 从 oauth-authorize-check.ts 升级而来，成为 domain/auth 的一部分。
 * 独立于 HTTP/DB 层，便于单元测试。
 *
 * @module domain/auth/oauth-authorize
 */
import { ENTITY_ACTIVE, ADMIN_ROLE_CODES } from '@auth-sso/contracts';

export interface AuthorizationInput {
  userId: string;
  clientId: string;
  roles: Array<{ id: string; code: string; status: string }>;
  roleClients?: Array<{ roleId: string; clientId: string }>;
}

export interface AuthorizationResult {
  allowed: boolean;
  errorCode?: 'unauthorized_client' | 'no_roles' | 'user_inactive';
  message?: string;
}

const ADMIN_ROLES = new Set<string>(ADMIN_ROLE_CODES);

/**
 * 检查用户是否有权访问指定的 OAuth Client
 *
 * 逻辑链路：
 *   1. 筛选 ACTIVE 角色
 *   2. 管理员角色（SUPER_ADMIN / ADMIN）直接放行
 *   3. 非管理员需通过 roleClients 绑定检查
 *   4. 无任何有效角色则拒绝
 */
export function checkUserClientAccess(input: AuthorizationInput): AuthorizationResult {
  const { clientId, roles, roleClients = [] } = input;

  const activeRoles = roles.filter((r) => r.status === ENTITY_ACTIVE);
  const activeRoleIds = new Set(activeRoles.map((r) => r.id));

  if (activeRoles.length === 0) {
    return {
      allowed: false,
      errorCode: 'no_roles',
      message: '您的账号尚未分配任何有效角色，无法访问系统。',
    };
  }

  const isAdmin = activeRoles.some((r) => ADMIN_ROLES.has(r.code));
  if (isAdmin) {
    return { allowed: true };
  }

  const hasClientBinding = roleClients.some(
    (rc) => activeRoleIds.has(rc.roleId) && rc.clientId === clientId,
  );

  if (!hasClientBinding) {
    return {
      allowed: false,
      errorCode: 'unauthorized_client',
      message: '您没有访问该系统的权限，请联系管理员分配。',
    };
  }

  return { allowed: true };
}

/**
 * OAuth 授权准入的完整用户视角输入（纯数据，零 DB 依赖）
 *
 * 由 Controller 从 data 层获取数据后传入，domain 函数不感知 DB 形状。
 */
export interface AuthorizeUserInput {
  userId: string;
  clientId: string;
  /** 用户状态（如 'ACTIVE' | 'DISABLED' | 'LOCKED'） */
  status: string;
  /** 用户的活跃角色，含 Client 绑定信息 */
  roles: Array<{
    id: string;
    code: string;
    status: string;
    /** 该角色绑定的 OAuth Client 列表 */
    roleClients: Array<{ roleId: string; clientId: string }>;
  }>;
}

/**
 * 完整的 OAuth 授权准入校验（纯函数，收敛 Controller 中散落的业务规则）
 *
 * 逻辑链路：
 *   1. 用户状态检查 — 仅 ACTIVE 用户可通过
 *   2. 有效角色检查 — 至少一个 ACTIVE 角色
 *   3. Client 访问绑定 — 管理员放行，否则需 roleClients 绑定
 *
 * 替代原先散落在 authorize/route.ts 中的 3 段内联判断
 * （user.status !== ENTITY_ACTIVE / userRoles.length === 0 / flatMap roleClients）。
 */
export function validateAuthorization(input: AuthorizeUserInput): AuthorizationResult {
  // 1. 用户状态检查（原先 Controller 内联 if）
  if (input.status !== ENTITY_ACTIVE) {
    return {
      allowed: false,
      errorCode: 'user_inactive',
      message: '您的账号已被锁定或禁用，请联系管理员。',
    };
  }

  // 2. 筛选有效角色（原先 Controller 内联 .map + .filter）
  const activeRoles = input.roles.filter((r) => r.status === ENTITY_ACTIVE);
  if (activeRoles.length === 0) {
    return {
      allowed: false,
      errorCode: 'no_roles',
      message: '您的账号尚未分配任何有效角色，无法访问系统。',
    };
  }

  // 3. 委托现有 Client 准入检查（收敛原先 Controller 内联 .flatMap）
  const roleClients = activeRoles.flatMap((r) => r.roleClients);
  return checkUserClientAccess({
    userId: input.userId,
    clientId: input.clientId,
    roles: activeRoles,
    roleClients,
  });
}
