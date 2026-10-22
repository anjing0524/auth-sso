/**
 * 路由 → 功能权限映射（菜单可见性与 layout 守卫共用）
 *
 * @req R5
 */
import { describe, it, expect } from 'vitest';
import { accessForPath, canAccessPath, ROUTE_ACCESS } from './route-access';

const subject = (codes: string[]) => ({ roleCodes: ['QA_ROLE'], permissionCodes: codes });

describe('route-access', () => {
  it('dashboard 对任意已登录用户开放', () => {
    expect(accessForPath('/dashboard')?.permissions).toEqual([]);
    expect(canAccessPath(subject([]), '/dashboard')).toBe(true);
  });

  it('已知路由要求对应 LIST 权限（含子路径）', () => {
    expect(canAccessPath(subject(['portal:user:list']), '/users')).toBe(true);
    expect(canAccessPath(subject(['portal:user:list']), '/users/abc')).toBe(true);
    expect(canAccessPath(subject([]), '/users')).toBe(false);
    expect(canAccessPath(subject(['portal:client:list']), '/clients/portal')).toBe(true);
  });

  it('管理员角色绕过功能权限（与 can/canAny 同一语义）', () => {
    expect(canAccessPath({ roleCodes: ['SUPER_ADMIN'], permissionCodes: [] }, '/roles')).toBe(true);
  });

  it('未登记路径不做额外限制，查询串不影响匹配', () => {
    expect(accessForPath('/profile')).toBeUndefined();
    expect(canAccessPath(subject([]), '/profile')).toBe(true);
    expect(accessForPath('/users?page=2')?.permissions).toEqual(['portal:user:list']);
    expect(accessForPath('/users/')?.permissions).toEqual(['portal:user:list']);
  });

  it('映射覆盖全部后台页面（新增页面必须登记）', () => {
    expect(Object.keys(ROUTE_ACCESS).sort()).toEqual(
      ['/audit-logs', '/clients', '/dashboard', '/departments', '/permissions', '/roles', '/users'].sort(),
    );
  });
});
