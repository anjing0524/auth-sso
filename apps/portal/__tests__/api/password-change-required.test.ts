/**
 * 首登强制改密的鉴权门禁。
 *
 * @req US-SEC-02, NFR-SEC-13
 * @vitest-environment node
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { USER_ERRORS, type UserPermissionContext } from '@auth-sso/contracts';
import type * as verifyJwtModule from '@/lib/auth/verify-jwt';
import type * as permissionsModule from '@/lib/permissions';

const state = vi.hoisted(() => ({
  mustChangePassword: true,
}));

// @allow-module-mock @/lib/auth/verify-jwt input-fixture: 固定当前身份；真实鉴权入口由 checkPermission 承担
vi.mock(import('@/lib/auth/verify-jwt'), async (importOriginal): Promise<Partial<typeof verifyJwtModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveIdentity: (async () => ({
      userId: '00000000-0000-4000-8000-000000000001',
    })) as typeof actual.resolveIdentity,
  };
});

// @allow-module-mock @/lib/permissions input-fixture: 只构造带 mustChangePassword 的权限上下文，验证拒绝/放行分支
vi.mock(import('@/lib/permissions'), async (importOriginal): Promise<Partial<typeof permissionsModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    getUserPermissionContext: async (): Promise<{ kind: 'ok'; context: UserPermissionContext }> => ({
      kind: 'ok',
      context: {
        roles: [{ id: 'r1', code: 'SUPER_ADMIN', name: '超级管理员' }],
        permissions: [],
        deptIds: [],
        mustChangePassword: state.mustChangePassword,
      },
    }),
  };
});

const { checkPermission } = await import('@/lib/auth/check-permission');

describe('checkPermission — 首登强制改密', () => {
  beforeEach(() => {
    state.mustChangePassword = true;
  });

  it('未改密时连 SUPER_ADMIN 也被拒绝，并返回专属错误码', async () => {
    const result = await checkPermission({ permissions: ['portal:user:read'] });
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.reason.code).toBe(USER_ERRORS.PASSWORD_CHANGE_REQUIRED);
      expect(result.reason.status).toBe(403);
    }
  });

  it('强制改密 action 显式放行', async () => {
    const result = await checkPermission({ allowPasswordChangeRequired: true });
    expect(result.authorized).toBe(true);
  });

  it('已改密用户正常通过', async () => {
    state.mustChangePassword = false;
    const result = await checkPermission({ permissions: ['portal:user:read'] });
    expect(result.authorized).toBe(true);
  });
});
