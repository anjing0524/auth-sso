/**
 * @req D-ROLE-C, D-ROLE-U, D-ROLE-D
 */
import { describe, it, expect } from 'vitest';
import {
  createRole,
  applyRoleUpdate,
  guardNotSystemRole,
  toDomainRole,
} from '@/domain/role/role';
import { CreateRoleInputSchema } from '@/domain/role/types';
import { BusinessRuleViolationError } from '@/domain/shared/errors';

const mockIdGen = () => 'role_id_12345';

describe('Role 领域核心规则', () => {
  it('应通过工厂函数创建初始状态为 ACTIVE 的角色', () => {
    const input = CreateRoleInputSchema.parse({ name: '管理员', code: 'ADMIN', dataScopeType: 'ALL', sort: 0 });
    const role = createRole(input, mockIdGen);
    expect(role.status).toBe('ACTIVE');
    expect(role.isSystem).toBe(false);
    expect(role.code).toBe('ADMIN');
  });

  it('应使用默认 dataScopeType SELF', () => {
    const input = CreateRoleInputSchema.parse({ name: '访客', code: 'GUEST' });
    const role = createRole(input, mockIdGen);
    expect(role.dataScopeType).toBe('SELF');
  });

  it('applyRoleUpdate 应正确 merge 字段', () => {
    const input = CreateRoleInputSchema.parse({ name: '旧名称', code: 'OLD', dataScopeType: 'SELF' });
    const role = createRole(input, mockIdGen);
    const updated = applyRoleUpdate(role, { name: '新名称', description: '新描述' });
    expect(updated.name).toBe('新名称');
    expect(updated.description).toBe('新描述');
    expect(updated.code).toBe('OLD'); // 未修改保持原值
  });

  it('guardNotSystemRole 应阻止操作系统角色', () => {
    const input = CreateRoleInputSchema.parse({ name: '系统角色', code: 'SYS' });
    const role = createRole(input, mockIdGen);
    const sysRole = { ...role, isSystem: true };
    expect(() => guardNotSystemRole(sysRole)).toThrow(BusinessRuleViolationError);
  });

  it('guardNotSystemRole 应允许操作非系统角色', () => {
    const input = CreateRoleInputSchema.parse({ name: '普通角色', code: 'NORMAL' });
    const role = createRole(input, mockIdGen);
    expect(() => guardNotSystemRole(role)).not.toThrow();
  });

  it('toDomainRole 应正确转换 DB 行', () => {
    const row = {
      id: 'id1', publicId: 'pub1', name: 'Admin', code: 'ADMIN',
      description: '管理员', dataScopeType: 'ALL',
      isSystem: true, status: 'ACTIVE', sort: 1,
      createdAt: new Date('2025-01-01'),
    };
    const role = toDomainRole(row);
    expect(role.name).toBe('Admin');
    expect(role.dataScopeType).toBe('ALL');
    expect(role.isSystem).toBe(true);
  });
});
