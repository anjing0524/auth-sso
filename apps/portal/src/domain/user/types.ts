import { z } from 'zod';
import { type UserStatus } from '@auth-sso/contracts';
import { userStatusEnum, PasswordSchema } from '@/domain/shared/zod-schemas';

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
  name: z.string().min(1, '姓名不能为空'),
  username: z.string().min(3, '用户名至少3位'),
  email: z.string().email('邮箱格式不合法'),
  password: PasswordSchema,
  deptId: z.string().nullable().optional(),
});
export type CreateUserInput = z.infer<typeof CreateUserInputSchema>;

export const UpdateUserInputSchema = z.object({
  id: z.string().min(1, '用户ID不能为空'),
  name: z.string().min(1, '姓名不能为空').optional(),
  email: z.string().email('邮箱格式不合法').optional(),
  status: userStatusEnum.optional(),
  deptId: z.string().nullable().optional(),
  avatarUrl: z.string().optional(),
});

export const UserIdentityInputSchema = z.object({
  id: z.string().min(1, '用户ID不能为空'),
});

export type UpdateUserInput = z.infer<typeof UpdateUserInputSchema>;
