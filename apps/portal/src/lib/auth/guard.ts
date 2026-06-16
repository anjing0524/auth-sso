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
import { headers } from 'next/headers';
import { checkPermission, type PermissionCheckOptions } from './check-permission';
import { mapDomainError } from '@/domain/shared/error-mapping';
import type { ApiResponse } from '@auth-sso/contracts';

/**
 * 鉴权通过后注入给业务函数的上下文
 */
export interface AuthContext {
  /** 当前操作者用户 ID（已通过权限校验） */
  userId: string;
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
    const check = await checkPermission(await headers(), options);
    if (!check.authorized || !check.userId) {
      return { success: false, error: check.error || 'FORBIDDEN', message: check.error || '权限不足' };
    }

    // 第二道：领域错误统一映射（mapDomainError 横切层）
    try {
      return await fn({ userId: check.userId }, ...args);
    } catch (err: unknown) {
      const mapped = mapDomainError(err);
      return { success: false, error: mapped.error, message: mapped.message };
    }
  };
}
