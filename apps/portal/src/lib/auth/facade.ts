import 'server-only';

/**
 * 鉴权统一入口 (Auth Facade)
 *
 * 本文件为组合层，将鉴权能力按职责拆分为三个独立子模块（R24）：
 * - `./verify-jwt`           身份验证（"你是谁"）
 * - `./check-permission`     权限/角色检查（"你能做什么"）
 * - `./data-scope`           数据范围过滤（"你能看哪些数据"）
 * - `./server-logger`        底层数据读取访问日志
 */
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { COMMON_ERRORS, type AuditOperation } from '@auth-sso/contracts';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { createLogger } from '@/lib/logger';
import { writeAuditLog, extractClientIP, extractUserAgent } from '@/lib/audit';

const log = createLogger('AuthFacade');

import {
  checkPermission,
  type PermissionCheckOptions,
  type PermissionCheckResult,
} from './check-permission';
import {
  getUserRoleDeptIds,
  canAccessDept,
} from './data-scope';
import { logServerDataRead } from './server-logger';

// 统一透出子模块能力
export {
  checkPermission,
  getUserRoleDeptIds,
  canAccessDept,
  logServerDataRead,
};
export type { PermissionCheckOptions, PermissionCheckResult };

/**
 * 创建权限保护的 API 响应包装器
 * 统一处理鉴权失败返回，简化 API 路由的权限保护写法
 *
 * @param options 权限控制要求参数
 * @param handler 核心业务处理控制器回调（注入 userId 和 JWT claims）
 * @returns 统一脱敏且契约化的 NextResponse
 */
export async function withPermission(
  options: PermissionCheckOptions,
  handler: (userId: string) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    const check = await checkPermission(options);

    if (!check.authorized) {
      return NextResponse.json(
        { success: false, error: COMMON_ERRORS.FORBIDDEN, message: check.error },
        { status: check.statusCode }
      );
    }

    if (!check.userId) {
      return NextResponse.json(
        { success: false, error: COMMON_ERRORS.INTERNAL_ERROR, message: '鉴权上下文缺失' },
        { status: 500 },
      );
    }

    const response = await handler(check.userId);
    if (options.audit) {
      recordAudit(check.userId, options.audit);
    }
    return response;
  } catch (error: unknown) {
    // mapDomainError 统一映射领域错误 → HTTP 语义，内部识别并静默处理 prerendering 中断
    const mapped = mapDomainError(error);
    // 非预渲染中断的错误需要记录日志，便于生产环境排查
    if (mapped.status >= 500) {
      log.error('服务执行异常', { error: mapped.error, message: mapped.message });
    }
    return NextResponse.json(
      { success: false, error: mapped.error, message: mapped.message },
      { status: mapped.status }
    );
  }
}

/**
 * 审计日志 fire-and-forget 写入（API Route 路径专用）
 *
 * 与 guard.ts 的 recordAudit 实现一致，但本文件服务于 REST API 路由。
 */
async function recordAudit(userId: string, operation: AuditOperation): Promise<void> {
  try {
    const h = await headers();
    writeAuditLog({
      userId,
      operation,
      method: h.get('x-action-method') || 'API',
      url: h.get('x-action-path') || null,
      ip: extractClientIP(h),
      userAgent: extractUserAgent(h),
      status: 200,
    });
  } catch {
    // 审计写入失败不影响业务（fire-and-forget 语义）
  }
}
