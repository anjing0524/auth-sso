import 'server-only';

/**
 * Server Action 鉴权与错误映射高阶函数 (Auth Guard Wrapper)
 *
 * 职责：为 Server Action 统一施加"精细鉴权 + 领域错误映射"两道防线，
 * 使每个写 Controller 在编译期就无法跳过安全检查（R21 / AE7 / §8.3 第三层防御）。
 *
 * 抽取样板后，被包装的业务函数只需专注：
 *   Zod 门禁校验 → 领域纯函数 → Drizzle 直调
 * 从而将 Controller 函数体收敛至 ≤ 20 行（R9 / 红线 #3）。
 *
 * @module lib/auth/guard
 */
import { checkPermission, type PermissionCheckOptions } from './check-permission';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { writeAuditLog, extractClientIP, extractUserAgent } from '@/lib/audit';
import { headers } from 'next/headers';
import { COMMON_ERRORS, type AuditOperation, type ApiResponse } from '@auth-sso/contracts';
import type { PortalJwtClaims } from '../session';

/**
 * 鉴权通过后注入给业务函数的上下文
 *
 * 携带 `claims`（含 `deptIds` 子树展开结果），使 Server Action 能执行
 * 与 API Route 等价的数据范围校验（canAccessDept），消除"双 Controller
 * 路径安全强度不一致"的越权风险（R7 / H-ACL-002）。
 */
export interface AuthContext {
  /** 当前操作者用户 ID（已通过权限校验） */
  userId: string;
  /** 操作者 JWT claims（含 roles/permissions/deptIds） */
  claims: PortalJwtClaims;
}

/**
 * 用精细鉴权 + 错误映射包装一个 Server Action
 *
 * @param options 权限检查选项（permissions / roles / requireAll）
 * @param fn      核心业务函数，首个参数接收 AuthContext，其余参数为外部入参
 * @returns 与原函数同签名、返回值统一为 ApiResponse<T> 的包装函数
 *
 * @example
 * ```ts
 * export const createUserAction = withAuth(
 *   { permissions: ['user:create'] },
 *   async (_ctx, input: CreateUserInput) => { ... }
 * );
 * ```
 */
export function withAuth<TArgs extends unknown[], TData>(
  options: PermissionCheckOptions,
  fn: (ctx: AuthContext, ...args: TArgs) => Promise<ApiResponse<TData>>
): (...args: TArgs) => Promise<ApiResponse<TData>> {
  return async (...args: TArgs): Promise<ApiResponse<TData>> => {
    // 第一道：精细权限编码/角色校验（实时查 DB + Redis 缓存）
    // checkPermission 可能因 resolveIdentity → headers()/cookies() 抛出异常
    // （如构建期 prerendering 中断信号），由外层 Suspense 边界统一处理。
    // 请求期这些平台 API 不会 throw，但异常路径仍需兜底。
    try {
      const check = await checkPermission(options);
      if (!check.authorized || !check.userId) {
        return { success: false, error: check.error || COMMON_ERRORS.FORBIDDEN, message: check.error || '权限不足' };
      }

      // checkPermission 保证 authorized 为 true 时 claims 非空（与 withPermission 对齐的运行时兜底）
      if (!check.claims) {
        return { success: false, error: COMMON_ERRORS.INTERNAL_ERROR, message: '鉴权上下文缺失' };
      }

      // 第二道：领域错误统一映射（mapDomainError 横切层）
      try {
        const res = await fn({ userId: check.userId, claims: check.claims }, ...args);
        // 审计拦截：业务成功 + 声明了 audit 操作 → fire-and-forget 写 audit_logs
        if (res.success && options.audit) {
          recordAudit(check.userId, options.audit);
        }
        return res;
      } catch (err: unknown) {
        const mapped = mapDomainError(err);
        return { success: false, error: mapped.error, message: mapped.message };
      }
    } catch (err: unknown) {
      // checkPermission 自身抛出的异常（非 DomainError，如 resolveIdentity 异常）
      const mapped = mapDomainError(err);
      return { success: false, error: mapped.error, message: mapped.message };
    }
  };
}

/**
 * 审计日志 fire-and-forget 写入（Server Action 路径专用）
 *
 * 从 next/headers 读取请求元数据（与 resolveIdentity 同一请求上下文，
 * resolveIdentity 已成功意味着 headers() 可用），提取操作者 IP/UA/方法/URL。
 */
async function recordAudit(userId: string, operation: AuditOperation): Promise<void> {
  try {
    const h = await headers();
    writeAuditLog({
      userId,
      operation,
      method: h.get('x-action-method') || 'ACTION',
      url: h.get('x-action-path') || null,
      ip: extractClientIP(h),
      userAgent: extractUserAgent(h),
      status: 200,
    });
  } catch {
    // 审计写入失败不影响业务（fire-and-forget 语义）
  }
}
