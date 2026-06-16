import { z } from 'zod';
import {
  type EntityStatus,
  type PermissionType,
} from '@auth-sso/contracts';
import { entityStatusEnum, permissionTypeEnum } from '@/domain/shared/zod-schemas';

/**
 * 权限领域实体接口 (纯 TS interface)
 */
export interface Permission {
  /** 内部 ID */
  id: string;
  /** 对外公开展示 ID */
  publicId: string;
  /** 权限名称 */
  name: string;
  /** 权限编码 (唯一标识) */
  code: string;
  /** 权限类型 */
  type: PermissionType;
  /** 资源路径 */
  resource: string | null;
  /** 操作类型 */
  action: string | null;
  /** 父权限 ID */
  parentId: string | null;
  /** 状态 */
  status: EntityStatus;
  /** 排序权重 */
  sort: number;
  /** 创建时间 */
  createdAt: Temporal.Instant;
}

/** 创建权限入参校验 Schema */
export const CreatePermissionInputSchema = z.object({
  name: z.string().min(1, '权限名称不能为空'),
  code: z.string().min(1, '权限编码不能为空').toLowerCase(),
  type: permissionTypeEnum.default('API'),
  resource: z.string().optional(),
  action: z.string().optional(),
  parentId: z.string().nullable().optional(),
  sort: z.number().int().default(0),
});

/** 更新权限入参校验 Schema */
export const UpdatePermissionInputSchema = z.object({
  name: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  type: permissionTypeEnum.optional(),
  resource: z.string().nullable().optional(),
  action: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  sort: z.number().int().optional(),
  status: entityStatusEnum.optional(),
});

export type CreatePermissionInput = z.infer<typeof CreatePermissionInputSchema>;
export type UpdatePermissionInput = z.infer<typeof UpdatePermissionInputSchema>;
