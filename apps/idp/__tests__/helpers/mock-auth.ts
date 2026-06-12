/**
 * Better Auth Mock 工具
 * 提供 Better Auth 核心方法的 mock 工厂
 * 用于 IdP API 单元测试中模拟认证状态
 */
import { vi } from 'vitest';

/**
 * 创建 mock 版本的 Better Auth auth 对象
 * 默认行为：返回已认证的管理员 session
 *
 * @param overrides 覆盖默认 session 数据的选项
 * @returns mock auth 对象
 */
export function createMockBetterAuth(overrides: { userId?: string; isAdmin?: boolean } = {}) {
  const userId = overrides.userId ?? 'admin-user-id';
  const isAdmin = overrides.isAdmin ?? true;

  const mockSession = {
    user: {
      id: userId,
      email: 'admin@example.com',
      name: '管理员',
      status: 'ACTIVE',
      role: isAdmin ? 'SUPER_ADMIN' : 'USER',
    },
    session: {
      id: 'mock-session-id',
      expiresAt: new Date(Date.now() + 3600 * 1000),
    },
  };

  const authApi = {
    getSession: vi.fn(async () => mockSession),
    signOut: vi.fn(async () => ({ success: true })),
    revokeSession: vi.fn(async () => true),
    revokeUserSessions: vi.fn(async () => true),
  };

  return {
    /** Better Auth API mock */
    api: authApi,
    /** Mock session 数据 */
    mockSession,

    /** 切换为"未登录"模式 */
    mockUnauthenticated() {
      authApi.getSession.mockResolvedValueOnce(null as any);
    },

    /** 切换为用户状态 */
    mockUserStatus(status: string) {
      mockSession.user.status = status;
    },

    /** 重置全部 mock */
    reset() {
      vi.clearAllMocks();
      mockSession.user.status = 'ACTIVE';
    },
  };
}
