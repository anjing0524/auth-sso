import { ENTITY_ACTIVE } from '@auth-sso/contracts';
import type { CreateDepartmentInput, Department, DepartmentTreeNode } from './types';
import { BusinessRuleViolationError } from '../shared/errors';
import { buildTree } from '@/domain/shared/tree-utils';

export type { Department, DepartmentTreeNode };

/**
 * 纯函数：计算物化路径 (ancestors)
 * 父级 ancestors + 父级 id → 新部门的 ancestors
 */
export function computeAncestors(parentId: string, parentAncestors: string | null): string {
  return parentAncestors ? `${parentAncestors}/${parentId}` : parentId;
}

/**
 * 将 Drizzle 数据库行转换为领域 Department 实体
 */
export function toDomainDepartment(row: {
  id: string;
  parentId: string | null;
  ancestors: string | null;
  name: string;
  code: string | null;
  sort: number | null;
  status: import('@auth-sso/contracts').EntityStatus;
  createdAt: Date;
}): Department {
  return {
    id: row.id,
    parentId: row.parentId,
    ancestors: row.ancestors,
    name: row.name,
    code: row.code,
    sort: row.sort ?? 0,
    status: row.status,
    createdAt: Temporal.Instant.fromEpochMilliseconds(row.createdAt.getTime()),
  };
}

/**
 * 工厂函数：构建新部门实体 (无副作用)
 */
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

/**
 * 纯函数：构建更新后的部门对象 (无副作用)
 *
 * 当 parentId 变更时，ancestors 参数必须传入重新计算后的值（调用方负责查询父级 ancestors）。
 */
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

/**
 * 纯函数：检查将部门移至目标父部门是否会产生环形引用
 */
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

/**
 * 纯函数：带环形引用校验的部门更新 (无副作用)
 */
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

/**
 * 纯函数：当 parentId 变更时，计算新部门的 ancestors 物化路径
 */
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

// ────────────────────────────────────────────
// DB 行转换（统一 Controller 层的列映射，消除重复）
// ────────────────────────────────────────────

/** 将领域实体转为 Drizzle insert 行 */
export function departmentToInsertRow(d: Department) {
  return {
    id: d.id,
    name: d.name,
    code: d.code,
    parentId: d.parentId,
    ancestors: d.ancestors,
    sort: d.sort,
    status: d.status,
    createdAt: new Date(d.createdAt.epochMilliseconds),
  };
}

/** 将领域实体转为 Drizzle update 行 */
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

/**
 * 纯函数：将扁平部门列表构建为树形结构
 */
export function buildDepartmentTree(flatList: Department[]): DepartmentTreeNode[] {
  return buildTree(flatList, 'id', 'parentId');
}
