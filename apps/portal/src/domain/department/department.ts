import type { CreateDepartmentInput, Department, DepartmentTreeNode } from './types';
import { ENTITY_ACTIVE } from '@auth-sso/contracts';
import { BusinessRuleViolationError } from '../shared/errors';
import { buildTree } from '@/domain/shared/tree-utils';

export type { Department, DepartmentTreeNode };

export function computeAncestors(parentId: string, parentAncestors: string | null): string {
  return parentAncestors ? `${parentAncestors}/${parentId}` : parentId;
}

export function createDepartment(
  input: CreateDepartmentInput,
  idGenerator: () => string,
  parentAncestors: string | null = null,
): Department {
  const ancestors = input.parentId ? computeAncestors(input.parentId, parentAncestors) : null;
  return {
    id: idGenerator(),
    parentId: input.parentId ?? null,
    ancestors,
    name: input.name,
    code: input.code ?? null,
    sort: input.sort,
    status: ENTITY_ACTIVE,
    createdAt: new Date(),
  };
}

export function applyDepartmentUpdate(
  dept: Department,
  patch: Partial<Pick<Department, 'name' | 'code' | 'parentId' | 'sort' | 'status'>> & { ancestors?: string | null },
): Department {
  return {
    ...dept,
    name: patch.name ?? dept.name,
    code: patch.code !== undefined ? patch.code : dept.code,
    parentId: patch.parentId !== undefined ? patch.parentId : dept.parentId,
    ancestors: patch.ancestors !== undefined ? patch.ancestors : dept.ancestors,
    sort: patch.sort ?? dept.sort,
    status: patch.status ?? dept.status,
  };
}

export function validateNoCircularReference(
  deptId: string,
  newParentId: string,
  allDepts: Array<{ id: string; parentId: string | null }>,
): void {
  if (deptId === newParentId) {
    throw new BusinessRuleViolationError('不能将父部门设为自身，这会导致环形死锁');
  }
  let currentId: string | null = newParentId;
  const visited = new Set<string>();
  while (currentId) {
    if (currentId === deptId) {
      throw new BusinessRuleViolationError('不能将父部门设为其子部门，这会导致环形死锁');
    }
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const parent = allDepts.find(d => d.id === currentId);
    currentId = parent?.parentId ?? null;
  }
}

export function applyDepartmentUpdateWithCircularCheck(
  dept: Department,
  patch: Partial<Pick<Department, 'name' | 'code' | 'parentId' | 'sort' | 'status'>> & { ancestors?: string | null },
  allDepts: Array<{ id: string; parentId: string | null }>,
): Department {
  if (patch.parentId !== undefined && patch.parentId !== dept.parentId && patch.parentId) {
    validateNoCircularReference(dept.id, patch.parentId, allDepts);
  }
  return applyDepartmentUpdate(dept, patch);
}

export function resolveParentAncestors(
  dept: Department,
  parentId: string | null | undefined,
  allDepts: Array<{ id: string; parentId: string | null; ancestors: string | null }>,
): string | null | undefined {
  if (parentId === undefined || parentId === dept.parentId) return undefined;
  if (!parentId) return null;
  const parent = allDepts.find(d => d.id === parentId);
  return parent ? computeAncestors(parent.id, parent.ancestors) : null;
}

export function buildDepartmentTree(flatList: Department[]): DepartmentTreeNode[] {
  return buildTree(flatList, 'id', 'parentId', 'sort');
}

export function computeAncestorPrefix(deptId: string, ancestors: string | null): string {
  return ancestors ? `${ancestors}/${deptId}` : deptId;
}

export function validateDepartmentDeletable(checks: { hasChildren: boolean; userCount: number; roleCount: number }): void {
  if (checks.hasChildren) throw new BusinessRuleViolationError('该部门下有子部门，无法删除');
  if (checks.userCount > 0) throw new BusinessRuleViolationError('该部门下存在关联用户，无法删除');
  if (checks.roleCount > 0) throw new BusinessRuleViolationError('该部门下存在关联角色，无法删除');
}

export function departmentToInsertRow(d: Department) {
  return {
    id: d.id,
    name: d.name,
    code: d.code,
    parentId: d.parentId,
    ancestors: d.ancestors,
    sort: d.sort,
    status: d.status,
    createdAt: d.createdAt,
  };
}

export function departmentToUpdateRow(d: Department) {
  return {
    name: d.name,
    code: d.code,
    parentId: d.parentId,
    ancestors: d.ancestors,
    sort: d.sort,
    status: d.status,
  };
}
