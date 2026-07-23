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

import { resolveIdentity } from './verify-jwt';
import { getRedis } from '@/infrastructure/redis';
import { REDIS_KEY_PREFIX, ADMIN_ROLE_CODES } from '@auth-sso/contracts';
import type { AuditOperation } from '@auth-sso/contracts';
import { getUserPermissionContext } from '@/lib/permissions';

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
  /**
   * 审计操作类型（可选）。
   * 声明后，withAuth / withPermission 包装器在业务函数成功执行后
   * 自动 fire-and-forget 写入 audit_logs（DC-AUDIT-IMMUTABLE / NFR-SEC-07）。
   */
  audit?: AuditOperation;
}

/**
 * 权限检查结果返回结构定义
 */
export interface PermissionCheckResult {
  authorized: boolean;
  userId?: string;
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
  const identity = await resolveIdentity();
  if (!identity) {
    return { authorized: false, error: '未登录', statusCode: 401 };
  }
  const { userId } = identity;

  let roles: string[] = [];
  let permissions: string[] = [];

  // Redis 缓存读取（独立 try/catch：失败视为缓存 miss，恢复时继续走 DB 回退）
  let cached: string | null = null;
  try {
    const redis = getRedis();
    const cacheKey = `${REDIS_KEY_PREFIX.USER_PERMS}${userId}`;
    cached = await redis.get(cacheKey);
  } catch {
    // Redis 不可用，跳过缓存，进入 DB 回退路径
  }

  if (cached) {
    try {
      const ctx = JSON.parse(cached);
      roles = ctx.roles?.map((r: any) => r.code) ?? [];
      permissions = ctx.permissions ?? [];
    } catch {
      // 缓存数据损坏，视为 miss，进入 DB 回退路径
    }
  }

  if (roles.length === 0 && permissions.length === 0) {
    const ctx = await getUserPermissionContext(userId);
    if (ctx) {
      roles = ctx.roles.map(r => r.code);
      permissions = ctx.permissions;
    }
  }

  if (roles.some((rc) => (ADMIN_ROLE_CODES as readonly string[]).includes(rc))) {
    return { authorized: true, userId };
  }

  const checkList = (required: string[], owned: string[], mode: boolean | undefined) =>
    mode ? required.every((x) => owned.includes(x)) : required.some((x) => owned.includes(x));

  if (options.permissions?.length) {
    if (!checkList(options.permissions, permissions, options.requireAll)) {
      return { authorized: false, userId, error: '权限不足', statusCode: 403 };
    }
  }

  if (options.roles?.length) {
    if (!checkList(options.roles, roles, options.requireAll)) {
      return { authorized: false, userId, error: '角色权限不足', statusCode: 403 };
    }
  }

  return { authorized: true, userId };
}

/**
 * Server Component 权限守卫 — React.cache() 同请求去重
 *
 * 替代每个 page.tsx 中手写的 checkPermission + if (!authorized) 样板。
 * Layout 和 Page 各自调用时命中缓存，零额外开销。
 *
 * @param options 权限检查选项
 * @returns 鉴权通过返回 { userId }，失败返回 null
 */
export const requirePermission = cache(
  async (options: PermissionCheckOptions): Promise<{ userId: string } | null> => {
    const auth = await checkPermission(options);
    return auth.authorized && auth.userId ? { userId: auth.userId } : null;
  },
);
