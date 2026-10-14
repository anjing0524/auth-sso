import type { CreateDepartmentInput, Department, DepartmentTreeNode } from './types';
import { DEPARTMENT_ERRORS, ENTITY_ACTIVE } from '@auth-sso/contracts';
import { BusinessRuleViolationError } from '../shared/errors';
import { buildTree } from '@/domain/shared/tree-utils';
import { dateFromInstant, instantFromDate } from '@/domain/shared/time';

export type { Department, DepartmentTreeNode };

function computeAncestors(parentId: string, parentAncestors: string | null): string {
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
    createdAt: Temporal.Now.instant(),
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

/**
 * 删除部门的前置校验。
 *
 * **根部门恒不可删，故这条检查在最前**——它与"有没有子部门/用户/角色"无关：
 * ADR-002 明确「系统预置角色绑在根部门，根部门不可删除（`CANNOT_DELETE_ROOT` 保护）」。
 * 此前该守卫从未实现，根部门只在"恰好有角色绑在它身上"时**偶然**被 roleCount 挡住；
 * 一旦角色被移走（或全新库尚未播种角色），根部门就能被删掉，留下
 * `parentId` 指向不存在行的孤儿部门（该列**没有外键**，不会级联清理）。
 *
 * 携带具体业务码（而非通用 `VALIDATION_ERROR`），使客户端可判别。
 */
export function validateDepartmentDeletable(checks: {
  /** 是否根部门（`parentId IS NULL`，与 seed-rbac 查找根部门的判据一致） */
  isRoot: boolean;
  hasChildren: boolean;
  userCount: number;
  roleCount: number;
}): void {
  if (checks.isRoot) {
    throw new BusinessRuleViolationError('根部门不可删除', DEPARTMENT_ERRORS.CANNOT_DELETE_ROOT);
  }
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
    createdAt: dateFromInstant(d.createdAt),
  };
}

export function departmentFromPersistence(department: Omit<Department, 'createdAt'> & { createdAt: Date }): Department {
  return { ...department, createdAt: instantFromDate(department.createdAt) };
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
