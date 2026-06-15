import 'server-only';

/**
 * 权限/角色检查子模块 (Permission & Role Check)
 *
 * 职责：基于身份验证 (verify-jwt) 解析出的 userId，实时查询 DB + Redis 缓存，
 * 执行细粒度的权限编码、角色校验，以及超级管理员绕过判定。
 *
 * 本模块解决“你能做什么”，依赖 verify-jwt 解决“你是谁”。
 *
 * @module lib/auth/check-permission
 */
import type { NextRequest } from 'next/server';
import type { PortalJwtClaims } from '../session';
import type { UserPermissionContext } from '../permissions';
import { getUserPermissionContext } from '../permissions';
import { resolveIdentity } from './verify-jwt';

/**
 * 权限检查选项接口定义
 */
export interface PermissionCheckOptions {
  /** 需要的权限编码列表（requireAll=false 时满足任一即可） */
  permissions?: string[];
  /** 需要的角色编码列表（requireAll=false 时满足任一即可） */
  roles?: string[];
  /** 为 true 时要求满足所有权限/角色，默认 false（满足任一即可） */
  requireAll?: boolean;
}

/**
 * 权限检查结果返回结构定义
 */
export interface PermissionCheckResult {
  authorized: boolean;
  userId?: string;
  /** 验签通过后的完整 JWT 声明（含 roles/permissions/deptId 等） */
  claims?: PortalJwtClaims;
  error?: string;
  statusCode?: number;
}

/**
 * 在 Session 模式下（claims 为 null）合成一份兼容性 claims，
 * 使下游消费方统一拿到 claims 结构。
 *
 * @param userId     用户 ID
 * @param ctx        用户权限上下文
 * @returns 合成的 PortalJwtClaims
 */
function synthesizeClaims(userId: string, ctx: UserPermissionContext): PortalJwtClaims {
  return {
    sub: userId,
    iss: 'http://localhost:4000',
    aud: 'portal-client',
    jti: 'session_' + userId,
    roles: ctx.roles.map((r) => r.code),
    permissions: ctx.permissions,
    deptId: ctx.deptId ?? undefined,
    dataScopeType: ctx.dataScopeType,
  } as PortalJwtClaims;
}

/**
 * 检查当前请求用户的身份有效性及 Portal 细粒度权限
 * 用于 Portal 自身管理 API 路由与 Server Action 的保护
 *
 * @param request NextRequest 对象或 Headers
 * @param options 权限检查选项（角色、权限与组合关系）
 * @returns 鉴权通过状态或精细化失败提示
 */
export async function checkPermission(
  request: NextRequest | Headers | undefined,
  options: PermissionCheckOptions
): Promise<PermissionCheckResult> {
  try {
    const identity = await resolveIdentity(request);
    if (!identity) {
      return { authorized: false, error: '未登录', statusCode: 401 };
    }
    const { userId, claims } = identity;

    // 获取用户在 Portal DB 中的细粒度权限上下文（Redis 缓存，TTL 5min）
    const ctx = await getUserPermissionContext(userId);
    if (!ctx) {
      console.error('[PermissionCheck] 无法获取用户权限上下文, userId:', userId);
      return { authorized: false, error: '无法获取用户权限', statusCode: 500 };
    }

    const roleCodes = ctx.roles.map((r) => r.code);
    const resolvedClaims = claims ?? synthesizeClaims(userId, ctx);

    // 超级管理员直接绕过所有校验
    if (roleCodes.includes('ADMIN') || roleCodes.includes('SUPER_ADMIN')) {
      return { authorized: true, userId, claims: resolvedClaims };
    }

    // 权限编码检查
    if (options.permissions && options.permissions.length > 0) {
      const ok = options.requireAll
        ? options.permissions.every((p) => ctx.permissions.includes(p))
        : options.permissions.some((p) => ctx.permissions.includes(p));
      if (!ok) {
        return { authorized: false, userId, claims: resolvedClaims, error: '权限不足', statusCode: 403 };
      }
    }

    // 角色编码检查
    if (options.roles && options.roles.length > 0) {
      const ok = options.requireAll
        ? options.roles.every((r) => roleCodes.includes(r))
        : options.roles.some((r) => roleCodes.includes(r));
      if (!ok) {
        return { authorized: false, userId, claims: resolvedClaims, error: '角色权限不足', statusCode: 403 };
      }
    }

    return { authorized: true, userId, claims: resolvedClaims };
  } catch (error: any) {
    console.error('[PermissionCheck] 鉴权过程异常:', error.message, error.stack);
    return { authorized: false, error: '权限检查失败', statusCode: 500 };
  }
}

/**
 * 检查用户是否有超级管理员权限（基于 DB 角色，不依赖 JWT claims）
 *
 * @param userId 用户唯一标识 ID
 * @returns 是否为超级管理员
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  try {
    const ctx = await getUserPermissionContext(userId);
    if (!ctx) return false;
    return ctx.roles.some((r) => r.code === 'SUPER_ADMIN' || r.code === 'ADMIN');
  } catch (error) {
    console.error('[isSuperAdmin] 查询超级管理员状态失败:', error);
    return false;
  }
}
