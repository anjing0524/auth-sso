import { z } from 'zod';
import {
  type EntityStatus,
  type PermissionType,
} from '@auth-sso/contracts';
import { entityStatusEnum, permissionTypeEnum } from '@/domain/shared/zod-schemas';

/**
 * 权限领域实体接口 (纯 TS interface)
 *
 * 合并了旧 menus 表的功能。
 * type 鉴别列决定字段生效规则：
 * - DIRECTORY/PAGE: path, icon, visible（菜单相关）
 * - API: clientId（接口鉴权），code 格式 {clientId}:{resource}:{action}
 *
 * v2 变更：移除 publicId，新增 path/icon/visible（合并 menus）
 * v3 变更：移除 resource/action，code 字段已包含完整信息（ADR-008）
 */
export interface Permission {
  /** 内部 ID（UUID） */
  id: string;
  /** 权限名称 */
  name: string;
  /** 权限编码 (唯一标识，API 类型格式 {clientId}:{resource}:{action}) */
  code: string;
  /** 权限类型（鉴别列） */
  type: PermissionType;
  /** 描述 */
  description: string | null;
  /** 前端路由路径（PAGE 必填） */
  path: string | null;
  /** 图标名称（DIRECTORY/PAGE） */
  icon: string | null;
  /** 侧边栏可见（DIRECTORY/PAGE） */
  visible: boolean | null;
  /** 归属 OAuth Client（仅 API 类型） */
  clientId: string | null;
  /** 父节点 ID（权限树） */
  parentId: string | null;
  /** 状态 */
  status: EntityStatus;
  /** 排序权重 */
  sort: number;
  /** 创建时间 */
  createdAt: Temporal.Instant;
}

/**
 * 权限树节点（含子节点引用）
 */
export interface PermissionTreeNode extends Permission {
  children: PermissionTreeNode[];
}

/** 创建权限入参校验 Schema（基于 type 的 discriminated union） */
export const CreatePermissionInputSchema = z.discriminatedUnion('type', [
  // DIRECTORY：菜单目录
  z.object({
    type: z.literal('DIRECTORY'),
    code: z.string().min(1, '权限编码不能为空').max(150, '权限编码最多 150 个字符'),
    name: z.string().min(1, '权限名称不能为空').max(100, '权限名称最多 100 个字符'),
    description: z.string().max(500, '描述最多 500 个字符').optional(),
    path: z.string().max(200, '路由路径最多 200 个字符').optional(),
    icon: z.string().max(50, '图标名最多 50 个字符').optional(),
    visible: z.boolean().default(true),
    parentId: z.string().nullable().optional(),
    sort: z.number().int().default(0),
  }),
  // PAGE：菜单页面
  z.object({
    type: z.literal('PAGE'),
    code: z.string().min(1, '权限编码不能为空').max(150, '权限编码最多 150 个字符'),
    name: z.string().min(1, '权限名称不能为空').max(100, '权限名称最多 100 个字符'),
    description: z.string().max(500, '描述最多 500 个字符').optional(),
    path: z.string().min(1, 'PAGE 类型必须指定 path').max(200, '路由路径最多 200 个字符'),
    icon: z.string().max(50, '图标名最多 50 个字符').optional(),
    visible: z.boolean().default(true),
    parentId: z.string().nullable().optional(),
    sort: z.number().int().default(0),
  }),
  // API：接口权限（code 格式 {clientId}:{resource}:{action}）
  z.object({
    type: z.literal('API'),
    code: z.string().min(1, '权限编码不能为空').max(150, '权限编码最多 150 个字符'),
    name: z.string().min(1, '权限名称不能为空').max(100, '权限名称最多 100 个字符'),
    description: z.string().max(500, '描述最多 500 个字符').optional(),
    clientId: z.string().optional(),
    parentId: z.string().nullable().optional(),
    sort: z.number().int().default(0),
  }),
]);

/** 更新权限入参校验 Schema */
export const UpdatePermissionInputSchema = z.object({
  name: z.string().min(1).max(100, '权限名称最多 100 个字符').optional(),
  code: z.string().min(1).max(150, '权限编码最多 150 个字符').optional(),
  type: permissionTypeEnum.optional(),
  description: z.string().nullable().optional(),
  path: z.string().max(200, '路由路径最多 200 个字符').nullable().optional(),
  icon: z.string().max(50, '图标名最多 50 个字符').nullable().optional(),
  visible: z.boolean().optional(),
  clientId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  sort: z.number().int().optional(),
  status: entityStatusEnum.optional(),
});

export type CreatePermissionInput = z.infer<typeof CreatePermissionInputSchema>;
