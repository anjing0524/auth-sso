import 'server-only';

/**
 * 鉴权统一入口 (Auth Facade)
 *
 * 本文件为组合层，将鉴权能力按职责拆分为三个独立子模块（R24）：
 * - `./verify-jwt`           身份验证（"你是谁"）
 * - `./check-permission`     权限/角色检查（"你能做什么"）
 * - `./data-scope`           数据范围过滤（"你能看哪些数据"）
 *
 * 此处统一 re-export，新增代码建议直接从子模块导入。
 *
 * @module lib/auth/facade
 */
import { NextResponse } from 'next/server';
import { COMMON_ERRORS } from '@auth-sso/contracts';
import { mapDomainError } from '@/domain/shared/error-mapping';
import type { PortalJwtClaims } from '../session';
import {
  checkPermission,
  type PermissionCheckOptions,
  type PermissionCheckResult,
} from './check-permission';
import {
  checkDataScope,
  getDataScopeFilter,
  applyDataScopeFilter,
} from './data-scope';

// 统一透出子模块能力
export {
  checkPermission,
  checkDataScope,
  getDataScopeFilter,
  applyDataScopeFilter,
};
export type { PermissionCheckOptions, PermissionCheckResult };

/**
 * 创建权限保护的 API 响应包装器
 * 统一处理鉴权失败返回，简化 API 路由的权限保护写法
 *
 * @param request NextRequest 对象
 * @param options 权限控制要求参数
 * @param handler 核心业务处理控制器回调（注入 userId 和 JWT claims）
 * @returns 统一脱敏且契约化的 NextResponse
 */
export async function withPermission(
  options: PermissionCheckOptions,
  handler: (userId: string, claims: PortalJwtClaims) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    const check = await checkPermission(options);

    if (!check.authorized) {
      return NextResponse.json(
        { error: COMMON_ERRORS.FORBIDDEN, message: check.error },
        { status: check.statusCode }
      );
    }

    // checkPermission 保证 authorized 为 true 时 userId 与 claims 均非空（运行时断言兜底）
    if (!check.userId || !check.claims) {
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '鉴权上下文缺失' },
        { status: 500 },
      );
    }
    return await handler(check.userId, check.claims);
  } catch (error: unknown) {
    const mapped = mapDomainError(error);
    console.error('[AuthFacade] 服务执行异常:', mapped.message, error instanceof Error ? error.stack : '');
    return NextResponse.json(
      { error: mapped.error, message: mapped.message },
      { status: mapped.status }
    );
  }
}
