import type { EntityStatus } from '@auth-sso/contracts';
import { ENTITY_ACTIVE } from '@auth-sso/contracts';
import type { CreateDepartmentInput, Department, DepartmentTreeNode } from './types';
import { BusinessRuleViolationError } from '../shared/errors';
import { buildTree } from '@/domain/shared/tree-utils';

export type { Department, DepartmentTreeNode };

/**
 * 将 Drizzle 数据库行转换为领域 Department 实体
 */
export function toDomainDepartment(row: {
  id: string;
  publicId: string;
  parentId: string | null;
  name: string;
  code: string | null;
  sort: number | null;
  status: string;
  createdAt: Date;
}): Department {
  return {
    id: row.id,
    publicId: row.publicId,
    parentId: row.parentId,
    name: row.name,
    code: row.code,
    sort: row.sort ?? 0,
    status: row.status as EntityStatus,
    createdAt: Temporal.Instant.fromEpochMilliseconds(row.createdAt.getTime()),
  };
}

/**
 * 工厂函数：构建新部门实体 (无副作用)
 */
export function createDepartment(
  input: CreateDepartmentInput,
  idGenerator: (len: number) => string,
): Department {
  return {
    id: idGenerator(20),
    publicId: `dept_${idGenerator(8)}`,
    parentId: input.parentId ?? null,
    name: input.name,
    code: input.code ?? null,
    sort: input.sort,
    status: ENTITY_ACTIVE,
    createdAt: Temporal.Now.instant(),
  };
}

/**
 * 纯函数：构建更新后的部门对象 (无副作用)
 */
export function applyDepartmentUpdate(
  dept: Department,
  patch: Partial<Pick<Department, 'name' | 'code' | 'parentId' | 'sort' | 'status'>>,
): Department {
  return {
    ...dept,
    name: patch.name ?? dept.name,
    code: patch.code !== undefined ? patch.code : dept.code,
    parentId: patch.parentId !== undefined ? patch.parentId : dept.parentId,
    sort: patch.sort ?? dept.sort,
    status: patch.status ?? dept.status,
  };
}

/**
 * 纯函数：检查将部门移至目标父部门是否会产生环形引用
 *
 * @param deptId 当前部门 ID
 * @param newParentId 目标父部门 ID
 * @param allDepts 所有部门列表（用于查找祖先链）
 * @throws BusinessRuleViolationError 如果会产生环形引用
 */
export function validateNoCircularReference(
  deptId: string,
  newParentId: string,
  allDepts: Array<{ id: string; parentId: string | null }>,
): void {
  if (deptId === newParentId) {
    throw new BusinessRuleViolationError('不能将父部门设为自身，这会导致环形死锁');
  }

  // 追溯祖先链：检查 newParentId 是否是 deptId 的后代
  let currentId: string | null = newParentId;
  const visited = new Set<string>();
  while (currentId) {
    if (currentId === deptId) {
      throw new BusinessRuleViolationError('不能将父部门设为其子部门，这会导致环形死锁');
    }
    if (visited.has(currentId)) break; // 已有环，安全退出
    visited.add(currentId);
    const parent = allDepts.find(d => d.id === currentId);
    currentId = parent?.parentId ?? null;
  }
}

/**
 * 纯函数：带环形引用校验的部门更新 (无副作用)
 *
 * 将 parentId 变更检测与环形引用校验从 Controller 层下沉至此，
 * 使 Controller 只需传入 allDepts 即可完成校验，无需自行编写 if 条件分支。
 *
 * @param dept      当前部门实体
 * @param patch     更新片段
 * @param allDepts  全部部门列表（用于祖先链追溯）
 * @returns 更新后的部门实体
 * @throws BusinessRuleViolationError 当 parentId 变更会产生环形引用时
 */
export function applyDepartmentUpdateWithCircularCheck(
  dept: Department,
  patch: Partial<Pick<Department, 'name' | 'code' | 'parentId' | 'sort' | 'status'>>,
  allDepts: Array<{ id: string; parentId: string | null }>,
): Department {
  // 检查 parentId 是否发生了变更，且新 parentId 非空
  if (patch.parentId !== undefined && patch.parentId !== dept.parentId && patch.parentId) {
    validateNoCircularReference(dept.id, patch.parentId, allDepts);
  }
  return applyDepartmentUpdate(dept, patch);
}

// ────────────────────────────────────────────
// DB 行转换（统一 Controller 层的列映射，消除重复）
// ────────────────────────────────────────────

/** 将领域实体转为 Drizzle insert 行 */
export function departmentToInsertRow(d: Department) {
  return {
    id: d.id,
    publicId: d.publicId,
    name: d.name,
    code: d.code,
    parentId: d.parentId,
    sort: d.sort,
    status: d.status,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** 将领域实体转为 Drizzle update 行 */
export function departmentToUpdateRow(d: Department) {
  return {
    name: d.name,
    code: d.code,
    parentId: d.parentId,
    sort: d.sort,
    status: d.status,
    updatedAt: new Date(),
  };
}

/**
 * 纯函数：将扁平部门列表构建为树形结构
 * 委托至泛型 buildTree 工具函数
 */
export function buildDepartmentTree(flatList: Department[]): DepartmentTreeNode[] {
  return buildTree(flatList, 'id', 'parentId');
}
