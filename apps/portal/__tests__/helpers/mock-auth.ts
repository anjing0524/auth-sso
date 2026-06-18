/**
 * Auth Middleware Mock 工具
 * 提供 withPermission / checkPermission 的 mock 工厂函数
 * 用于 API 单元测试中绕过认证中间件
 */
import { vi } from 'vitest';
import { NextResponse } from 'next/server';

/**
 * 创建 mock 版本的 withPermission
 * 默认行为：直接调用 handler 并传入指定 userId
 *
 * @param defaultUserId 默认传入 handler 的用户 ID
 * @returns { mockFn: Mock, setupAuth: Function }
 */
export function createMockWithPermission(defaultUserId = 'test-user-id') {
  const mockFn = vi.fn(
    async (_options: any, handler: (userId: string) => Promise<NextResponse>) => {
      return handler(defaultUserId);
    }
  );

  return {
    /** withPermission 的 mock 函数 */
    mockFn,
    /**
     * 切换为"未授权"模式（返回 401/403）
     * @param statusCode HTTP 状态码
     * @param errorMessage 错误消息
     */
    mockUnauthorized(statusCode = 401, errorMessage = '未登录') {
      mockFn.mockImplementationOnce(async () => {
        return NextResponse.json(
          { error: 'FORBIDDEN', message: errorMessage },
          { status: statusCode }
        );
      });
    },
    /**
     * 切换为指定 userId 模式
     * @param userId 传入 handler 的用户 ID
     */
    mockAsUser(userId: string) {
      mockFn.mockImplementationOnce(
        async (_options: any, handler: (userId: string) => Promise<NextResponse>) => {
          return handler(userId);
        }
      );
    },
  };
}

/**
 * 创建 mock 版本的 checkPermission
 * 默认行为：返回 authorized: true
 */
export function createMockCheckPermission(defaultUserId = 'test-user-id') {
  return vi.fn(async () => ({
    authorized: true,
    userId: defaultUserId,
  }));
}
