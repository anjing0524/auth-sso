/**
 * OAuth 授权准入的纯函数边界。
 *
 * Mutation 实测 validateAuthorization 仅 47%：管理员旁路、非活跃角色过滤、
 * 多角色绑定、scope 解析/拒绝路径没有直接覆盖。本文件补这些分支。
 */
import { describe, it, expect } from 'vitest';
import {
  parseScopes,
  validateRequestedScopes,
  validateAuthorization,
  InvalidScopeError,
} from '@/domain/auth/oauth-authorize';
import { ENTITY_ACTIVE } from '@auth-sso/contracts';

const role = (overrides: Partial<Parameters<typeof validateAuthorization>[0]['roles'][number]> = {}) => ({
  id: 'role-1',
  code: 'MEMBER',
  status: ENTITY_ACTIVE,
  clientIds: ['client-1'],
  ...overrides,
});

const base = {
  userId: 'user-1',
  clientId: 'client-1',
  status: ENTITY_ACTIVE,
  roles: [role()],
} as const;

describe('parseScopes', () => {
  it('去空白、按空白拆分并去重', () => {
    expect(parseScopes('  openid   profile\topenid ')).toEqual(['openid', 'profile']);
  });

  it('空串 → 空数组', () => {
    expect(parseScopes('   ')).toEqual([]);
  });
});

describe('validateRequestedScopes', () => {
  it('全部已注册 → 通过', () => {
    expect(() => validateRequestedScopes(['openid'], ['openid', 'profile'])).not.toThrow();
    expect(() => validateRequestedScopes([], ['openid'])).not.toThrow();
  });

  it('任一未注册 → InvalidScopeError', () => {
    expect(() => validateRequestedScopes(['openid', 'admin'], ['openid']))
      .toThrow(InvalidScopeError);
  });
});

describe('validateAuthorization', () => {
  it('管理员角色无需 client 绑定即可放行', () => {
    for (const code of ['ADMIN', 'SUPER_ADMIN']) {
      expect(validateAuthorization({ ...base, roles: [role({ code, clientIds: [] })] }).allowed)
        .toBe(true);
    }
  });

  it('非管理员必须在活跃角色中命中 client 绑定', () => {
    expect(validateAuthorization({ ...base, roles: [role({ clientIds: ['other'] })] }))
      .toMatchObject({ allowed: false, errorCode: 'unauthorized_client' });
    expect(validateAuthorization({ ...base, roles: [role({ clientIds: ['client-1'] })] }).allowed)
      .toBe(true);
  });

  it('多角色中任一活跃角色绑定即可', () => {
    expect(validateAuthorization({
      ...base,
      roles: [
        role({ id: 'role-a', clientIds: [] }),
        role({ id: 'role-b', clientIds: ['client-1'] }),
      ],
    }).allowed).toBe(true);
  });

  it('非活跃角色不参与判定；全部非活跃 → no_roles', () => {
    const result = validateAuthorization({
      ...base,
      roles: [role({ status: 'DISABLED', clientIds: ['client-1'] })],
    });
    expect(result).toMatchObject({ allowed: false, errorCode: 'no_roles' });
  });

  it('非 ACTIVE 用户优先返回 user_inactive', () => {
    for (const status of ['DISABLED', 'LOCKED', 'DELETED']) {
      expect(validateAuthorization({ ...base, status, roles: [role()] }))
        .toMatchObject({ allowed: false, errorCode: 'user_inactive' });
    }
  });

  it('拒绝结果带可读文案', () => {
    expect(validateAuthorization({ ...base, roles: [] }).message)
      .toContain('尚未分配任何有效角色');
    expect(validateAuthorization({ ...base, clientId: 'other' }).message)
      .toContain('没有访问该系统的权限');
  });
});
