import { z } from 'zod';
import {
  type EntityStatus,
  type DataScopeType,
} from '@auth-sso/contracts';
import { entityStatusEnum, dataScopeTypeEnum } from '@/domain/shared/zod-schemas';

/**
 * 角色领域实体接口 (纯 TS interface)
 */
export interface Role {
  /** 内部 ID */
  id: string;
  /** 对外公开展示 ID */
  publicId: string;
  /** 角色名称 */
  name: string;
  /** 角色编码 (唯一标识) */
  code: string;
  /** 角色描述 */
  description: string | null;
  /** 数据范围类型 */
  dataScopeType: DataScopeType;
  /** 是否为系统内置角色 */
  isSystem: boolean;
  /** 状态 */
  status: EntityStatus;
  /** 排序权重 */
  sort: number;
  /** 创建时间 */
  createdAt: Temporal.Instant;
}

/** 创建角色入参校验 Schema */
export const CreateRoleInputSchema = z.object({
  name: z.string().min(1, '角色名称不能为空'),
  code: z.string().min(1, '角色编码不能为空').toUpperCase(),
  description: z.string().optional(),
  dataScopeType: dataScopeTypeEnum.default('SELF'),
  sort: z.number().int().default(0),
});

/** 更新角色入参校验 Schema */
export const UpdateRoleInputSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  dataScopeType: dataScopeTypeEnum.optional(),
  sort: z.number().int().optional(),
  status: entityStatusEnum.optional(),
});

export type CreateRoleInput = z.infer<typeof CreateRoleInputSchema>;
export type UpdateRoleInput = z.infer<typeof UpdateRoleInputSchema>;
