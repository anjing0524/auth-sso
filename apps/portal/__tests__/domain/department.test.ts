/**
 * @req DC-DEPT-C, DC-DEPT-U, DC-DEPT-D
 */
import { describe, it, expect } from 'vitest';
import { DEPARTMENT_ERRORS } from '@auth-sso/contracts';
import { validateDepartmentDeletable,
  createDepartment,
  applyDepartmentUpdate,
  validateNoCircularReference,
  buildDepartmentTree,
} from '@/domain/department/department';
import { BusinessRuleViolationError } from '@/domain/shared/errors';

const mockIdGen = () => 'test_id_12345';

describe('validateDepartmentDeletable（删除前置校验）', () => {
  const clean = { isRoot: false, hasChildren: false, userCount: 0, roleCount: 0 };

  it('无依赖的非根部门 → 通过', () => {
    expect(() => validateDepartmentDeletable(clean)).not.toThrow();
  });

  it('**根部门 → 恒拒绝，且携带专属码**（ADR-002 的承诺；与是否有依赖无关）', () => {
    // 优先级：即便同时有子部门/用户/角色，也必须报"根部门不可删除"
    for (const extra of [{}, { hasChildren: true }, { userCount: 3 }, { roleCount: 2 }]) {
      try {
        validateDepartmentDeletable({ ...clean, ...extra, isRoot: true });
        expect.unreachable('根部门必须被拒绝');
      } catch (err) {
        // 具体业务码而非通用 VALIDATION_ERROR —— 客户端据此可判别
        expect((err as { code?: string }).code).toBe(DEPARTMENT_ERRORS.CANNOT_DELETE_ROOT);
      }
    }
  });

  it('有子部门 / 有关联用户 / 有关联角色 → 各自拒绝', () => {
    expect(() => validateDepartmentDeletable({ ...clean, hasChildren: true })).toThrow('该部门下有子部门');
    expect(() => validateDepartmentDeletable({ ...clean, userCount: 1 })).toThrow('该部门下存在关联用户');
    expect(() => validateDepartmentDeletable({ ...clean, roleCount: 1 })).toThrow('该部门下存在关联角色');
  });
});

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
});
