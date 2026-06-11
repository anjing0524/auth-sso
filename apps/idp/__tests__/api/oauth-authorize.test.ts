/**
 * IdP OAuth 授权检查逻辑单元测试
 * @req H-AUTH-001, H-AUTH-002, G-SEC-INT
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { checkUserClientAccess } from '../../src/lib/oauth-authorize-check';

/** 模拟角色数据 */
function role(code: string, status = 'ACTIVE') {
  return { id: `role-${code}`, code, name: code, status };
}

/** 模拟 role_clients 绑定 */
function roleClient(roleId: string, clientId: string) {
  return { roleId, clientId };
}

describe('checkUserClientAccess', () => {
  const testClientId = 'client-portal';
  const testUserId = 'user-1';

  it('SUPER_ADMIN 角色绕过 role_clients 检查返回 allowed', () => {
    const result = checkUserClientAccess({
      userId: testUserId,
      clientId: testClientId,
      roles: [role('SUPER_ADMIN')],
    });
    expect(result.allowed).toBe(true);
  });

  it('ADMIN 角色绕过 role_clients 检查返回 allowed', () => {
    const result = checkUserClientAccess({
      userId: testUserId,
      clientId: testClientId,
      roles: [role('ADMIN')],
    });
    expect(result.allowed).toBe(true);
  });

  it('普通用户有 role_clients 绑定返回 allowed', () => {
    const result = checkUserClientAccess({
      userId: testUserId,
      clientId: testClientId,
      roles: [role('USER')],
      roleClients: [roleClient('role-USER', testClientId)],
    });
    expect(result.allowed).toBe(true);
  });

  it('普通用户有多个角色其中之一绑定目标 client 返回 allowed', () => {
    const result = checkUserClientAccess({
      userId: testUserId,
      clientId: testClientId,
      roles: [role('USER'), role('VIEWER')],
      roleClients: [
        roleClient('role-USER', 'other-client'),
        roleClient('role-VIEWER', testClientId),
      ],
    });
    expect(result.allowed).toBe(true);
  });

  it('普通用户无 role_clients 绑定返回 not allowed (unauthorized_client)', () => {
    const result = checkUserClientAccess({
      userId: testUserId,
      clientId: testClientId,
      roles: [role('USER')],
      roleClients: [],
    });
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe('unauthorized_client');
  });

  it('普通用户有 role_clients 但不包含目标 client 返回 not allowed', () => {
    const result = checkUserClientAccess({
      userId: testUserId,
      clientId: testClientId,
      roles: [role('USER')],
      roleClients: [roleClient('role-USER', 'other-client')],
    });
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe('unauthorized_client');
  });

  it('用户无任何角色返回 not allowed (no_roles)', () => {
    const result = checkUserClientAccess({
      userId: testUserId,
      clientId: testClientId,
      roles: [],
      roleClients: [],
    });
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe('no_roles');
  });

  it('非 ACTIVE 状态角色不计入管理员判断（无 ACTIVE 角色时返回 no_roles）', () => {
    const result = checkUserClientAccess({
      userId: testUserId,
      clientId: testClientId,
      roles: [role('SUPER_ADMIN', 'DELETED')],
      roleClients: [],
    });
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe('no_roles');
  });

  it('仅有 ACTIVE 状态的角色才被计入 role_clients 检查', () => {
    const result = checkUserClientAccess({
      userId: testUserId,
      clientId: testClientId,
      roles: [role('USER'), role('VIEWER', 'DELETED')],
      roleClients: [roleClient('role-USER', testClientId)],
    });
    expect(result.allowed).toBe(true);
  });
});
