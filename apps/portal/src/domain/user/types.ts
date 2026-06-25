import { z } from 'zod';
import { type UserStatus } from '@auth-sso/contracts';
import { userStatusEnum } from '@/domain/shared/zod-schemas';

/**
 * 用户领域实体接口 (纯 TS interface)
 *
 * v2 变更：移除 publicId，新增 deletedAt、passwordChangedAt
 */
export interface User {
  /** 内部唯一标识 ID（UUID） */
  id: string;
  /** 登录用户名 */
  username: string;
  /** 邮箱地址 */
  email: string | null;
  /** 用户显示姓名 */
  name: string;
  /** 账号状态 */
  status: UserStatus;
  /** 所属部门 ID */
  deptId: string | null;
  /** 部门名称 (JOIN 计算字段，非物理数据库列) */
  deptName: string | null;
  /** 头像 URL */
  avatarUrl: string | null;
  /** 逻辑删除时间（US-B-11） */
  deletedAt: Temporal.Instant | null;
  /** 密码最后修改时间（US-SEC-02） */
  passwordChangedAt: Temporal.Instant | null;
  /** 创建时间 (UTC 精确时刻，不可变) */
  createdAt: Temporal.Instant;
}

/**
 * Server Action 创建用户入参校验 Schema
 */
export const CreateUserInputSchema = z.object({
  /** 姓名 */
  name: z.string().min(1, '姓名不能为空'),
  /** 用户名 */
  username: z.string().min(3, '用户名至少3位'),
  /** 邮箱 */
  email: z.string().email('邮箱格式不合法'),
  /** 密码 */
  password: z.string().min(8, '密码至少8位').regex(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, '密码须包含大小写字母和数字'),
  /** 部门 ID（UI 哨兵值 'ALL' 归一化在应用层处理，保持 Schema 纯粹） */
  deptId: z.string().nullable().optional(),
});
export type CreateUserInput = z.infer<typeof CreateUserInputSchema>;

/**
 * 更新用户入参校验 Schema
 */
export const UpdateUserInputSchema = z.object({
  /** 用户唯一标识 ID (必填) */
  id: z.string().min(1, '用户ID不能为空'),
  /** 姓名 (可选) */
  name: z.string().min(1, '姓名不能为空').optional(),
  /** 邮箱 (可选) */
  email: z.string().email('邮箱格式不合法').optional(),
  /** 账号状态 (可选) */
  status: userStatusEnum.optional(),
  /** 部门 ID (可选) */
  deptId: z.string().nullable().optional(),
  /** 头像 URL (可选) */
  avatarUrl: z.string().optional(),
});
/**
 * 用户身份标识入参校验 Schema (常用于详情获取、删除、切换状态)
 */
export const UserIdentityInputSchema = z.object({
  /** 用户唯一标识 ID */
  id: z.string().min(1, '用户ID不能为空'),
});

export type UpdateUserInput = z.infer<typeof UpdateUserInputSchema>;
