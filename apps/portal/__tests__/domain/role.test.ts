/**
 * @req DC-ROLE-C, DC-ROLE-U, DC-ROLE-D
 * v3.2: dataScopeType 已替换为 deptId
 */
import { describe, it, expect } from 'vitest';
import {
  createRole,
  applyRoleUpdate,
  guardNotSystemRole,
  toDomainRole,
  hasRolePermissionImpact,
  roleToInsertRow,
  roleToUpdateRow,
} from '@/domain/role/role';
import { CreateRoleInputSchema } from '@/domain/role/types';
import { BusinessRuleViolationError } from '@/domain/shared/errors';

const mockIdGen = () => 'role_id_12345';

describe('Role 领域核心规则', () => {
  it('应通过工厂函数创建初始状态为 ACTIVE 的角色', () => {
    const input = CreateRoleInputSchema.parse({ name: '管理员', code: 'ADMIN', deptId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789', sort: 0 });
    const role = createRole(input, mockIdGen);
    expect(role.status).toBe('ACTIVE');
    expect(role.isSystem).toBe(false);
    expect(role.code).toBe('ADMIN');
    expect(role.deptId).toBe('a1b2c3d4-e5f6-4789-abcd-ef0123456789');
  });

  it('缺少 deptId 时应被 Zod 校验拒绝', () => {
    const result = CreateRoleInputSchema.safeParse({ name: '访客', code: 'GUEST' });
    expect(result.success).toBe(false);
  });

  it('applyRoleUpdate 应正确 merge 字段', () => {
    const input = CreateRoleInputSchema.parse({ name: '旧名称', code: 'OLD', deptId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789' });
    const role = createRole(input, mockIdGen);
    const updated = applyRoleUpdate(role, { name: '新名称', description: '新描述' });
    expect(updated.name).toBe('新名称');
    expect(updated.description).toBe('新描述');
    expect(updated.code).toBe('OLD'); // 未修改保持原值
    expect(updated.deptId).toBe('a1b2c3d4-e5f6-4789-abcd-ef0123456789'); // 未修改保持原值
  });

  it('guardNotSystemRole 应阻止操作系统角色', () => {
    const input = CreateRoleInputSchema.parse({ name: '系统角色', code: 'SYS', deptId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789' });
    const role = createRole(input, mockIdGen);
    const sysRole = { ...role, isSystem: true };
    expect(() => guardNotSystemRole(sysRole)).toThrow(BusinessRuleViolationError);
  });

  it('guardNotSystemRole 应允许操作非系统角色', () => {
    const input = CreateRoleInputSchema.parse({ name: '普通角色', code: 'NORMAL', deptId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789' });
    const role = createRole(input, mockIdGen);
    expect(() => guardNotSystemRole(role)).not.toThrow();
  });

  it('toDomainRole 应正确转换 DB 行', () => {
    const row = {
      id: 'id1', publicId: 'pub1', name: 'Admin', code: 'ADMIN',
      description: '管理员', deptId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
      isSystem: true, status: 'ACTIVE' as any, sort: 1,
      createdAt: new Date('2025-01-01'),
    };
    const role = toDomainRole(row);
    expect(role.name).toBe('Admin');
    expect(role.deptId).toBe('a1b2c3d4-e5f6-4789-abcd-ef0123456789');
    expect(role.isSystem).toBe(true);
  });
});

describe('hasRolePermissionImpact', () => {
  const base = { deptId: 'dept-a', status: 'ACTIVE' as const };

  it('deptId 变更 → 返回 true', () => {
    expect(hasRolePermissionImpact(base, { ...base, deptId: 'dept-b' })).toBe(true);
  });

  it('status 变更 → 返回 true', () => {
    expect(hasRolePermissionImpact(base, { ...base, status: 'DISABLED' as const })).toBe(true);
  });

  it('permissionChanged=true → 返回 true（即使 deptId/status 不变）', () => {
    expect(hasRolePermissionImpact(base, base, true)).toBe(true);
  });

  it('全部不变 → 返回 false', () => {
    expect(hasRolePermissionImpact(base, base)).toBe(false);
  });
});

describe('row 转换函数', () => {
  const input = CreateRoleInputSchema.parse({ name: 'Test', code: 'TEST', deptId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789', sort: 0 });
  const role = createRole(input, mockIdGen);

  it('roleToInsertRow 应包含所有字段', () => {
    const row = roleToInsertRow(role);
    expect(row.id).toBe('role_id_12345');
    expect(row.name).toBe('Test');
    expect(row.code).toBe('TEST');
    expect(row.deptId).toBe('a1b2c3d4-e5f6-4789-abcd-ef0123456789');
    expect(row.status).toBe('ACTIVE');
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('roleToUpdateRow 不应包含 id', () => {
    const row = roleToUpdateRow(role);
    expect(row).not.toHaveProperty('id');
    expect(row.name).toBe('Test');
    expect(row.status).toBe('ACTIVE');
  });
});
