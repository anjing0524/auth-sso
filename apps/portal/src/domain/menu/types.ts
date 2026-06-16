import { z } from 'zod';
import { type EntityStatus, type MenuType } from '@auth-sso/contracts';
import { entityStatusEnum, menuTypeEnum } from '@/domain/shared/zod-schemas';

/**
 * 菜单领域实体接口 (纯 TS interface)
 */
export interface Menu {
  /** 内部 ID */
  id: string;
  /** 对外公开展示 ID */
  publicId: string;
  /** 父菜单 ID */
  parentId: string | null;
  /** 菜单名称 */
  name: string;
  /** 路由路径 */
  path: string | null;
  /** 关联权限编码 */
  permissionCode: string | null;
  /** 图标名称 */
  icon: string | null;
  /** 是否侧边栏可见 */
  visible: boolean;
  /** 排序权重 */
  sort: number;
  /** 菜单类型 */
  menuType: MenuType;
  /** 状态 */
  status: EntityStatus;
  /** 创建时间 */
  createdAt: Temporal.Instant;
}

/**
 * 树节点（含子节点引用）
 */
export interface MenuTreeNode extends Menu {
  children: MenuTreeNode[];
}

/** 创建菜单入参校验 Schema */
export const CreateMenuInputSchema = z.object({
  name: z.string().min(1, '菜单名称不能为空'),
  path: z.string().optional(),
  permissionCode: z.string().optional(),
  parentId: z.string().nullable().optional(),
  icon: z.string().optional(),
  sort: z.number().int().default(0),
  visible: z.boolean().default(true),
  menuType: menuTypeEnum.default('MENU'),
});

/** 更新菜单入参校验 Schema */
export const UpdateMenuInputSchema = z.object({
  name: z.string().min(1).optional(),
  path: z.string().nullable().optional(),
  permissionCode: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  sort: z.number().int().optional(),
  visible: z.boolean().optional(),
  menuType: menuTypeEnum.optional(),
  status: entityStatusEnum.optional(),
});

export type CreateMenuInput = z.infer<typeof CreateMenuInputSchema>;
export type UpdateMenuInput = z.infer<typeof UpdateMenuInputSchema>;
