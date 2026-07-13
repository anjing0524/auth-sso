/**
 * @req DC-DEPT-C, DC-DEPT-U, DC-DEPT-D
 */
import { describe, it, expect } from 'vitest';
import {
  createDepartment,
  applyDepartmentUpdate,
  validateNoCircularReference,
  buildDepartmentTree,
  toDomainDepartment,
} from '@/domain/department/department';
import { BusinessRuleViolationError } from '@/domain/shared/errors';

const mockIdGen = () => 'test_id_12345';

describe('Department 领域核心规则', () => {
  it('应通过工厂函数创建状态为 ACTIVE 的部门', () => {
    const dept = createDepartment({ name: '技术部', sort: 1 }, mockIdGen);
    expect(dept.status).toBe('ACTIVE');
    expect(dept.name).toBe('技术部');
    expect(dept.parentId).toBeNull();
  });

  it('应支持指定 parentId 创建子部门', () => {
    const dept = createDepartment({ name: '前端组', parentId: 'parent_1', sort: 0 }, mockIdGen);
    expect(dept.parentId).toBe('parent_1');
  });

  it('applyDepartmentUpdate 应正确 merge 字段', () => {
    const dept = createDepartment({ name: '旧名称', sort: 0 }, mockIdGen);
    const updated = applyDepartmentUpdate(dept, { name: '新名称', sort: 5 });
    expect(updated.name).toBe('新名称');
    expect(updated.sort).toBe(5);
    expect(updated.status).toBe('ACTIVE'); // 未修改保持原值
  });

  it('validateNoCircularReference 应阻止自身作为父部门', () => {
    expect(() => validateNoCircularReference('A', 'A', [])).toThrow(BusinessRuleViolationError);
  });

  it('validateNoCircularReference 应阻止子部门成为父部门', () => {
    // B 是 A 的子部门，A 不能将 B 设为父部门
    const allDepts = [
      { id: 'A', parentId: null },
      { id: 'B', parentId: 'A' },
      { id: 'C', parentId: 'B' },
    ];
    // 尝试将 A 的 parentId 设为 C（C 是 A 的孙子）→ 应拒绝
    expect(() => validateNoCircularReference('A', 'C', allDepts)).toThrow(BusinessRuleViolationError);
  });

  it('validateNoCircularReference 应允许合法的父部门变更', () => {
    const allDepts = [
      { id: 'A', parentId: null },
      { id: 'B', parentId: null },
      { id: 'C', parentId: 'A' },
    ];
    // C 从 A 移到 B → 合法
    expect(() => validateNoCircularReference('C', 'B', allDepts)).not.toThrow();
  });

  it('buildDepartmentTree 应正确构建树形结构', () => {
    const depts = [
      createDepartment({ name: '根部门', sort: 0 }, () => 'root_id_123'),
      createDepartment({ name: '子部门', parentId: 'root_id_123', sort: 0 }, () => 'child_id_45'),
    ];
    const tree = buildDepartmentTree(depts);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.name).toBe('根部门');
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children![0]!.name).toBe('子部门');
  });

  it('toDomainDepartment 应正确转换 DB 行', () => {
    const row = {
      id: 'd1', name: 'HR', parentId: null as string | null, ancestors: null as string | null,
      code: 'HR_CODE', sort: 10, status: 'ACTIVE' as any, createdAt: new Date('2025-01-01'),
    };
    const dept = toDomainDepartment(row);
    expect(dept.name).toBe('HR');
    expect(dept.status).toBe('ACTIVE');
    expect(dept.sort).toBe(10);
  });
});
