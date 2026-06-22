/**
 * @req D-PRM-C, D-PRM-U, D-PRM-D
 */
import { describe, it, expect } from 'vitest';
import {
  createPermission,
  applyPermissionUpdate,
  toDomainPermission,
} from '@/domain/permission/permission';
import { CreatePermissionInputSchema } from '@/domain/permission/types';

const mockIdGen = () => 'perm_id_12345';

describe('Permission 领域核心规则', () => {
  it('应通过工厂函数创建默认类型 API 的权限', () => {
    const input = CreatePermissionInputSchema.parse({ name: '用户列表', code: 'user:list' });
    const perm = createPermission(input, mockIdGen);
    expect(perm.status).toBe('ACTIVE');
    expect(perm.type).toBe('API');
    expect(perm.code).toBe('user:list');
  });

  it('应支持指定权限类型', () => {
    const input = CreatePermissionInputSchema.parse({ name: '仪表盘', code: 'dashboard:view', type: 'MENU' as any });
    const perm = createPermission(input, mockIdGen);
    expect(perm.type).toBe('MENU');
  });

  it('applyPermissionUpdate 应正确 merge 字段', () => {
    const input = CreatePermissionInputSchema.parse({ name: '旧名称', code: 'old:code' });
    const perm = createPermission(input, mockIdGen);
    const updated = applyPermissionUpdate(perm, { name: '新名称', status: 'DISABLED' });
    expect(updated.name).toBe('新名称');
    expect(updated.status).toBe('DISABLED');
    expect(updated.code).toBe('old:code');
  });

  it('toDomainPermission 应正确转换 DB 行', () => {
    const row = {
      id: 'p1', name: '测试权限', code: 'test:perm',
      type: 'API' as any, description: null, path: null, icon: null, visible: null,
      resource: '/api/users', action: 'create', clientId: null,
      parentId: null, status: 'ACTIVE' as any, sort: 10,
      createdAt: new Date('2025-01-01'),
    };
    const perm = toDomainPermission(row);
    expect(perm.type).toBe('API');
    expect(perm.resource).toBe('/api/users');
  });
});
