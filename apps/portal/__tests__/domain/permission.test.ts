/**
 * @req D-PRM-C, D-PRM-U, D-PRM-D
 */
import { describe, it, expect } from 'vitest';
import {
  createPermission,
  applyPermissionUpdate,
  validateMenuParent,
  validateMenuPath,
} from '@/domain/permission/permission';
import { CreatePermissionInputSchema } from '@/domain/permission/types';
import { buildVisibleMenuTree, type MenuPermissionRow } from '@/lib/menu-tree';

const mockIdGen = () => 'perm_id_12345';

describe('Permission 领域核心规则', () => {
  it('应通过工厂函数创建默认类型 API 的权限', () => {
    const input = CreatePermissionInputSchema.parse({ name: '用户列表', code: 'portal:user:list', type: 'API' });
    const perm = createPermission(input, mockIdGen);
    expect(perm.status).toBe('ACTIVE');
    expect(perm.type).toBe('API');
    expect(perm.code).toBe('portal:user:list');
  });

  it('应支持指定权限类型', () => {
    const input = CreatePermissionInputSchema.parse({ name: '仪表盘', code: 'portal:dashboard:view', type: 'DIRECTORY' as any });
    const perm = createPermission(input, mockIdGen);
    expect(perm.type).toBe('DIRECTORY');
  });

  it('applyPermissionUpdate 应正确 merge 字段', () => {
    const input = CreatePermissionInputSchema.parse({ name: '旧名称', code: 'portal:old:code', type: 'API' });
    const perm = createPermission(input, mockIdGen);
    const updated = applyPermissionUpdate(perm, { name: '新名称', status: 'DISABLED' });
    expect(updated.name).toBe('新名称');
    expect(updated.status).toBe('DISABLED');
    expect(updated.code).toBe('portal:old:code');
  });

  it('菜单路径只接受无查询参数和片段的站内绝对路径', () => {
    expect(() => validateMenuPath('PAGE', '/users')).not.toThrow();
    expect(() => validateMenuPath('PAGE', '//evil.example')).toThrow('站内绝对路径');
    expect(() => validateMenuPath('PAGE', '/users?admin=true')).toThrow('查询参数');
    expect(() => validateMenuPath('DIRECTORY', null)).not.toThrow();
  });

  it('菜单不能移动到自身或后代节点下', () => {
    const menus = [
      { id: 'root', parentId: null },
      { id: 'child', parentId: 'root' },
      { id: 'leaf', parentId: 'child' },
    ];
    expect(() => validateMenuParent('root', 'root', menus)).toThrow('自身');
    expect(() => validateMenuParent('root', 'leaf', menus)).toThrow('子节点');
    expect(() => validateMenuParent('leaf', 'root', menus)).not.toThrow();
  });

  it('菜单可见性使用显式绑定的 API 权限，空权限不会回退管理员菜单', () => {
    const rows: MenuPermissionRow[] = [
      { id: 'api-users', name: '用户列表', code: 'portal:user:list', type: 'API', path: null, icon: null, visible: null, parentId: null, requiredPermissionId: null },
      { id: 'users', name: '用户管理', code: 'menu:portal:users', type: 'PAGE', path: '/users', icon: 'Users', visible: true, parentId: null, requiredPermissionId: 'api-users' },
    ];
    expect(buildVisibleMenuTree(rows, [], false)).toEqual([]);
    expect(buildVisibleMenuTree(rows, ['portal:user:list'], false)[0]?.url).toBe('/users');
    expect(buildVisibleMenuTree(rows, [], true)[0]?.title).toBe('用户管理');
  });
});
