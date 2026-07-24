import 'server-only';

/**
 * Server Action / API Route 鉴权与错误映射高阶函数 (Auth Guard Wrapper)
 *
 * 职责：为 Server Action 与 API Route 统一施加"精细鉴权 + 领域错误映射"两道防线。
 *
 * - withAuth: Server Action 鉴权包装器，返回 ApiResponse<T>
 * - withPermission: API Route 鉴权包装器，返回 NextResponse
 *
 * @module lib/auth/guard
 */
import { type NextResponse } from 'next/server';
import { checkPermission, type PermissionCheckOptions } from './check-permission';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { recordActionAudit, recordApiAudit } from '@/lib/audit';
import { createLogger } from '@/lib/logger';
import { COMMON_ERRORS, type ApiResponse } from '@auth-sso/contracts';
import { restError } from '@/lib/response';

const log = createLogger('AuthGuard');

export interface AuthContext {
  userId: string;
}

export function withAuth<TArgs extends unknown[], TData>(
  options: PermissionCheckOptions,
  fn: (ctx: AuthContext, ...args: TArgs) => Promise<ApiResponse<TData>>
): (...args: TArgs) => Promise<ApiResponse<TData>> {
  return async (...args: TArgs): Promise<ApiResponse<TData>> => {
    try {
      const check = await checkPermission(options);
      if (!check.authorized || !check.userId) {
        return { success: false, error: check.error || COMMON_ERRORS.FORBIDDEN, message: check.error || '权限不足' };
      }

      try {
        const res = await fn({ userId: check.userId }, ...args);
        if (res.success && options.audit) await recordActionAudit(check.userId, options.audit);
        return res;
      } catch (err: unknown) {
        const mapped = mapDomainError(err);
        return { success: false, error: mapped.error, message: mapped.message };
      }
    } catch (err: unknown) {
      const mapped = mapDomainError(err);
      return { success: false, error: mapped.error, message: mapped.message };
    }
  };
}

export async function withPermission(
  options: PermissionCheckOptions,
  handler: (userId: string) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    const check = await checkPermission(options);

    if (!check.authorized) {
      return restError(COMMON_ERRORS.FORBIDDEN, check.error || '权限不足', check.statusCode ?? 403);
    }

    if (!check.userId) {
      return restError(COMMON_ERRORS.INTERNAL_ERROR, '鉴权上下文缺失', 500);
    }

    const response = await handler(check.userId);
    if (options.audit) await recordApiAudit(check.userId, options.audit);
    return response;
  } catch (error: unknown) {
    const mapped = mapDomainError(error);
    if (mapped.status >= 500) {
      log.error('服务执行异常', { error: mapped.error, message: mapped.message });
    }
    return restError(mapped.error, mapped.message, mapped.status);
  }
}
