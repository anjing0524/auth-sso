import 'server-only';

/**
 * 权限/角色检查子模块 (Permission & Role Check)
 *
 * 职责：基于身份验证 (verify-jwt) 解析出的 userId，实时查询 DB + Redis 缓存，
 * 执行细粒度的权限编码、角色校验，以及超级管理员绕过判定。
 *
 * 本模块解决"你能做什么"，依赖 verify-jwt 解决"你是谁"。
 *
 * @module lib/auth/check-permission
 */
import { cache } from 'react';
import type { PortalJwtClaims } from '../session';

import { resolveIdentity } from './verify-jwt';
import { ADMIN_ROLE_CODES } from '@auth-sso/contracts';

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
  /** 验签通过后的完整 JWT 声明 */
  claims?: PortalJwtClaims;
  error?: string;
  statusCode?: number;
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
  options: PermissionCheckOptions
): Promise<PermissionCheckResult> {
  try {
    const identity = await resolveIdentity();
    if (!identity) {
      return { authorized: false, error: '未登录', statusCode: 401 };
    }
    const { userId, claims } = identity;

    const roleCodes = claims.roles;

    // 超级管理员直接绕过所有校验
    if (roleCodes.some((rc) => (ADMIN_ROLE_CODES as readonly string[]).includes(rc))) {
      return { authorized: true, userId, claims };
    }

    // 权限编码检查
    if (options.permissions && options.permissions.length > 0) {
      const ok = options.requireAll
        ? options.permissions.every((p) => claims.permissions.includes(p))
        : options.permissions.some((p) => claims.permissions.includes(p));
      if (!ok) {
        return { authorized: false, userId, claims, error: '权限不足', statusCode: 403 };
      }
    }

    // 角色编码检查
    if (options.roles && options.roles.length > 0) {
      const ok = options.requireAll
        ? options.roles.every((r) => roleCodes.includes(r))
        : options.roles.some((r) => roleCodes.includes(r));
      if (!ok) {
        return { authorized: false, userId, claims, error: '角色权限不足', statusCode: 403 };
      }
    }

    return { authorized: true, userId, claims };
  } catch (error: any) {
    console.error('[PermissionCheck] 鉴权过程异常:', error.message, error.stack);
    return { authorized: false, error: '权限检查失败', statusCode: 500 };
  }
}

/**
 * Server Component 权限守卫 — React.cache() 同请求去重
 *
 * 替代每个 page.tsx 中手写的 checkPermission + if (!authorized) 样板。
 * Layout 和 Page 各自调用时命中缓存，零额外开销。
 *
 * @param options 权限检查选项
 * @returns 鉴权通过返回 userId，失败返回 null
 */
export const requirePermission = cache(
  async (options: PermissionCheckOptions): Promise<string | null> => {
    const auth = await checkPermission(options);
    return auth.authorized && auth.userId ? auth.userId : null;
  },
);
