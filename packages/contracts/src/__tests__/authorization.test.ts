/**
 * 授权判定纯函数测试
 *
 * 钉住 ADR-015 的核心：`isAdminRole` / `can` / `hasRole` / `canAny` / `canAll`
 * 是 Portal 服务端与客户端**共用的唯一判定实现**。
 *
 * 迁移前这条规则有七份拷贝（checkPermission / usePermissions / me route /
 * dashboard layout / ProfileClient / oauth-authorize / menu-tree），其中
 * 服务端 `checkList` 与客户端 `hasPermission` 是同一语义的两份独立实现。
 * 本测试锁住语义，使任何一处重新内联都会被行为差异暴露。
 *
 * @req H-ACL-001
 * @req H-ACL-002
 */
import { describe, it, expect } from 'vitest';
import {
  isAdminRole,
  hasPermissionCode,
  hasRole,
  can,
  canAny,
  canAll,
  type AuthorizationSubject,
} from '../authorization';

const ROOT: AuthorizationSubject = {
  roleCodes: ['SUPER_ADMIN'],
  permissionCodes: [],
};
const ADMIN: AuthorizationSubject = {
  roleCodes: ['ADMIN'],
  permissionCodes: [],
};
const USER: AuthorizationSubject = {
  roleCodes: ['USER'],
  permissionCodes: ['portal:user:list'],
};
const NONE: AuthorizationSubject = { roleCodes: [], permissionCodes: [] };

describe('isAdminRole', () => {
  it('SUPER_ADMIN 与 ADMIN 均判定为管理员', () => {
    expect(isAdminRole(['SUPER_ADMIN'])).toBe(true);
    expect(isAdminRole(['ADMIN'])).toBe(true);
  });

  it('普通角色与空集合不是管理员', () => {
    expect(isAdminRole(['USER'])).toBe(false);
    expect(isAdminRole([])).toBe(false);
  });

  it('多角色中只要含管理员即为真', () => {
    expect(isAdminRole(['USER', 'ADMIN'])).toBe(true);
  });

  it('大小写敏感（不对角色码做归一化）', () => {
    expect(isAdminRole(['admin'])).toBe(false);
  });
});

describe('can — 单条权限规则（服务端与客户端共用）', () => {
  it('管理员恒通过，即使不持有该权限码', () => {
    expect(can(ROOT, 'portal:audit:read')).toBe(true);
    expect(can(ADMIN, 'portal:audit:read')).toBe(true);
  });

  it('非管理员按权限码判定', () => {
    expect(can(USER, 'portal:user:list')).toBe(true);
    expect(can(USER, 'portal:audit:read')).toBe(false);
  });

  it('无角色无权限者一律拒绝', () => {
    expect(can(NONE, 'portal:user:list')).toBe(false);
  });
});

describe('hasRole — 角色归属不因管理员而绕过', () => {
  it('管理员身份不会让任意角色要求通过', () => {
    // 这是与 can 的关键区别：需要"必须是某角色"的场景不能靠管理员绕过
    expect(hasRole(ADMIN, 'AUDITOR')).toBe(false);
    expect(hasRole(ADMIN, 'ADMIN')).toBe(true);
  });

  it('普通角色匹配', () => {
    expect(hasRole(USER, 'USER')).toBe(true);
    expect(hasRole(USER, 'ADMIN')).toBe(false);
  });
});

describe('canAny / canAll — 多条权限的两种模式', () => {
  const required = ['portal:user:list', 'portal:audit:read'];

  it('canAny：满足任一即通过', () => {
    expect(canAny(USER, required)).toBe(true);
  });

  it('canAll：缺任一即拒绝', () => {
    expect(canAll(USER, required)).toBe(false);
  });

  it('canAll：全部具备时通过', () => {
    const both: AuthorizationSubject = {
      roleCodes: ['USER'],
      permissionCodes: ['portal:user:list', 'portal:audit:read'],
    };
    expect(canAll(both, required)).toBe(true);
  });

  it('空需求一律通过（不构成限制）', () => {
    expect(canAny(NONE, [])).toBe(true);
    expect(canAll(NONE, [])).toBe(true);
  });

  it('管理员对两种模式均通过', () => {
    expect(canAny(ADMIN, required)).toBe(true);
    expect(canAll(ADMIN, required)).toBe(true);
  });
});

describe('hasPermissionCode', () => {
  it('只查权限码，不受角色影响', () => {
    expect(hasPermissionCode(ADMIN, 'portal:user:list')).toBe(false);
    expect(hasPermissionCode(USER, 'portal:user:list')).toBe(true);
  });
});
