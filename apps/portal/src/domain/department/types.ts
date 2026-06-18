import { z } from 'zod';
import { type EntityStatus } from '@auth-sso/contracts';
import { entityStatusEnum } from '@/domain/shared/zod-schemas';

/**
 * 部门领域实体接口 (纯 TS interface)
 */
export interface Department {
  /** 内部 ID */
  id: string;
  /** 对外公开展示 ID */
  publicId: string;
  /** 父部门 ID */
  parentId: string | null;
  /** 物化路径 (ancestors)，用于高效子树查询。顶级为 null，子级如 'dept_001/dept_002' */
  ancestors: string | null;
  /** 部门名称 */
  name: string;
  /** 部门编码 */
  code: string | null;
  /** 排序权重 */
  sort: number;
  /** 状态 */
  status: EntityStatus;
  /** 创建时间 */
  createdAt: Temporal.Instant;
}

/**
 * 树节点（含子节点引用）
 */
export interface DepartmentTreeNode extends Department {
  children: DepartmentTreeNode[];
}

/** 创建部门入参校验 Schema */
export const CreateDepartmentInputSchema = z.object({
  name: z.string().min(1, '部门名称不能为空'),
  code: z.string().optional(),
  parentId: z.string().nullable().optional(),
  sort: z.number().int().default(0),
});

/** 更新部门入参校验 Schema */
export const UpdateDepartmentInputSchema = z.object({
  name: z.string().min(1, '部门名称不能为空').optional(),
  code: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  sort: z.number().int().optional(),
  status: entityStatusEnum.optional(),
});

export type CreateDepartmentInput = z.infer<typeof CreateDepartmentInputSchema>;
export type UpdateDepartmentInput = z.infer<typeof UpdateDepartmentInputSchema>;
