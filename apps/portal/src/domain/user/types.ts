import { z } from 'zod';
import { type UserStatus } from '@auth-sso/contracts';
import { userStatusEnum, PasswordSchema, EmailSchema } from '@/domain/shared/zod-schemas';

export interface User {
  id: string;
  username: string;
  email: string | null;
  name: string;
  status: UserStatus;
  deptId: string | null;
  avatarUrl: string | null;
  deletedAt: Temporal.Instant | null;
  passwordChangedAt: Temporal.Instant | null;
  createdAt: Temporal.Instant;
}

export const CreateUserInputSchema = z.object({
  name: z.string().min(1, '姓名不能为空').max(100, '姓名最多 100 个字符'),
  username: z.string().min(3, '用户名至少3位').max(50, '用户名最多 50 个字符'),
  email: EmailSchema,
  password: PasswordSchema,
  deptId: z.string().nullable().optional(),
});
export type CreateUserInput = z.infer<typeof CreateUserInputSchema>;

export const UpdateUserInputSchema = z.object({
  id: z.string().min(1, '用户ID不能为空'),
  name: z.string().min(1, '姓名不能为空').max(100, '姓名最多 100 个字符').optional(),
  email: EmailSchema.optional(),
  status: userStatusEnum.optional(),
  deptId: z.string().nullable().optional(),
  avatarUrl: z.string().max(500, '头像地址最多 500 个字符').optional(),
});

export const UserIdentityInputSchema = z.object({
  id: z.string().min(1, '用户ID不能为空'),
});
