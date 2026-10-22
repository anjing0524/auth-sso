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
import { canAll, canAny, hasRole as hasRoleShared, isAdminRole } from '@auth-sso/contracts';
import type { AuditOperation } from '@auth-sso/contracts';
import { getUserPermissionContext, toPermissionContextOrNull } from '@/lib/permissions';
import { ForbiddenError, UnauthenticatedError, type DomainError } from '@/domain/shared/errors';

/**
 * 权限检查选项接口定义
 */
export interface PermissionCheckOptions {
  /** 需要的权限编码列表（requireAll=false 时满足任一即可；管理员绕过） */
  permissions?: string[];
  /** 需要的角色编码列表（requireAll=false 时满足任一即可；**不因管理员而绕过**） */
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
 * 权限检查结果 —— **判别式联合**（架构巡检候选 1）
 *
 * 此前是 `{ authorized: boolean; userId?: string; error?: string; statusCode?: number }`：
 * 三个字段都可选 ⇒ "通过但没有 userId"是可表达的状态（调用点得自己补一个
 * "鉴权上下文缺失 ⇒ 500"分支），而 `error` 装的是**中文文案**却被调用点当**码**用
 * （`withAuth` 把 `check.error` 直接写进 `ApiError.error`，而契约里那是码）。
 * 测试替身因此写出了一个生产代码从不发出的码 `'FORBIDDEN'`——接口无法表达的不变量，
 * 只能靠人眼维持。
 *
 * 现在：通过则**必有** userId；失败则必带 `DomainError`（它自带码与状态），
 * 由调用点抛出、统一走 `mapServerError` 这一个映射入口。
 */
export type PermissionCheckResult =
  | { authorized: true; userId: string }
  | { authorized: false; reason: DomainError };

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
    return { authorized: false, reason: new UnauthenticatedError() };
  }
  const { userId } = identity;

  // 统一走 getUserPermissionContext（缓存 → null 标记 → DB 降级三态自管理）。
  // 此前这里手写过第二条 Redis 读取路径，缺陷有二：键拼装/解析与 permissions.ts
  // 双处漂移；用"空数组"误判缓存 miss，导致合法空权限用户每次请求穿透 DB。
  // ctx 为 null（用户不存在/DB 异常）时按无权限处理 = fail-close（ADR-011）。
  const ctx = toPermissionContextOrNull(await getUserPermissionContext(userId));
  // 判定统一委托 @auth-sso/contracts 的纯函数（与客户端共用同一实现，ADR-015）。
  const subject = {
    roleCodes: ctx?.roles.map((r) => r.code) ?? [],
    permissionCodes: ctx?.permissions ?? [],
  };

  // 管理员绕过权限码检查（ADR-001 既有语义）。角色归属**不**因此绕过。
  if (isAdminRole(subject.roleCodes)) {
    return { authorized: true, userId };
  }

  if (options.permissions?.length) {
    const ok = options.requireAll
      ? canAll(subject, options.permissions)
      : canAny(subject, options.permissions);
    if (!ok) {
      return { authorized: false, reason: new ForbiddenError('权限不足') };
    }
  }

  if (options.roles?.length) {
    const matched = options.roles.some((code) => hasRoleShared(subject, code));
    const ok = options.requireAll
      ? options.roles.every((code) => hasRoleShared(subject, code))
      : matched;
    if (!ok) {
      return { authorized: false, reason: new ForbiddenError('角色权限不足') };
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
    return auth.authorized ? { userId: auth.userId } : null;
  },
);
