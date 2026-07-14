'use server';

/**
 * 用户个人中心 Server Actions (自助服务)
 *
 * 只有登录用户本人可调用（withAuth 空权限），
 * 通过 ctx.userId 锁定操作目标（防止 IDOR）。
 * 满足 FR-USR-10（自助改密）/ FR-USR-12（自助改资料）。
 */
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { withAuth, type AuthContext } from '@/lib/auth';
import { verifyPassword, hashPassword, isPasswordReused, pushPasswordHistory } from '@/domain/auth/password';
import { revokeUserAccessByUserId } from '@/lib/session/revoke';
import { EntityNotFoundError } from '@/domain/shared/errors';
import { PasswordSchema } from '@/domain/shared/zod-schemas';
import { COMMON_ERRORS, type ApiResponse } from '@auth-sso/contracts';
import { createLogger } from '@/lib/logger';

const log = createLogger('ProfileAction');

/**
 * 自助改资料入参校验 Schema
 * 仅允许修改安全字段，不允许改 status / deptId（防越权）
 */
const UpdateOwnProfileSchema = z.object({
  /** 显示姓名 */
  name: z.string().min(1, '姓名不能为空').optional(),
  /** 邮箱 */
  email: z.string().email('邮箱格式不合法').optional(),
  /** 头像 URL */
  avatarUrl: z.string().url('头像 URL 格式不合法').optional().nullable(),
});

/**
 * 自助修改密码入参校验 Schema
 */
const ChangeOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1, '当前密码不能为空'),
  newPassword: PasswordSchema,
});

/**
 * 用户自助修改个人资料 Action Controller
 *
 * 限制可修改字段为 { name, email, avatarUrl }，防止越权修改 status/deptId。
 * 审计操作：无（资料修改非敏感审计事件，由业务决定是否加 audit）
 */
export const updateOwnProfileAction = withAuth(
  {},
  async (
    ctx: AuthContext,
    input: Record<string, unknown>,
  ): Promise<ApiResponse<{ id: string }>> => {
    const parsed = UpdateOwnProfileSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: COMMON_ERRORS.VALIDATION_ERROR, message: parsed.error.issues[0]!.message };
    }

    // 用 ctx.userId 锁定目标，防止 IDOR
    const row = await db.query.users.findFirst({ where: eq(schema.users.id, ctx.userId) });
    if (!row) throw new EntityNotFoundError('User', ctx.userId);

    // 仅更新有值的字段（partial update）
    const updates: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updates['name'] = parsed.data.name;
    if (parsed.data.email !== undefined) updates['email'] = parsed.data.email;
    if ('avatarUrl' in parsed.data) updates['avatarUrl'] = parsed.data.avatarUrl ?? null;

    if (Object.keys(updates).length === 0) {
      return { success: true, data: { id: ctx.userId }, message: '无内容变更' };
    }

    await db.update(schema.users).set(updates).where(eq(schema.users.id, ctx.userId));

    revalidatePath('/profile');
    return { success: true, data: { id: ctx.userId }, message: '资料已更新' };
  },
);

/**
 * 用户自助修改密码 Action Controller（FR-USR-10）
 *
 * 验证旧密码 → 哈希新密码 → 更新 passwordChangedAt → 失效所有会话（NFR-SEC-13）。
 * 审计：TOKEN_REVOKE（withAuth 自动记录）
 */
export const changeOwnPasswordAction = withAuth(
  { audit: 'TOKEN_REVOKE' },
  async (
    ctx: AuthContext,
    input: Record<string, unknown>,
  ): Promise<ApiResponse<{ id: string }>> => {
    const parsed = ChangeOwnPasswordSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: COMMON_ERRORS.VALIDATION_ERROR, message: parsed.error.issues[0]!.message };
    }

    // 用 ctx.userId 锁定目标，防止 IDOR
    const row = await db.query.users.findFirst({
      where: eq(schema.users.id, ctx.userId),
      columns: { id: true, passwordHash: true, passwordHistory: true },
    });
    if (!row) throw new EntityNotFoundError('User', ctx.userId);

    // 验证旧密码
    const isValid = await verifyPassword(parsed.data.currentPassword, row.passwordHash ?? '');
    if (!isValid) {
      return { success: false, error: COMMON_ERRORS.VALIDATION_ERROR, message: '当前密码错误' };
    }

    // NFR-SEC-15: 禁止重用最近 5 次密码
    if (await isPasswordReused(parsed.data.newPassword, row.passwordHistory ?? null)) {
      return { success: false, error: COMMON_ERRORS.VALIDATION_ERROR, message: '新密码不能与最近使用过的密码相同' };
    }

    // 哈希新密码并更新（同时记录 passwordChangedAt + 推入密码历史）
    const newHash = await hashPassword(parsed.data.newPassword);
    const newHistory = pushPasswordHistory(row.passwordHistory ?? null, row.passwordHash ?? '');
    await db
      .update(schema.users)
      .set({ passwordHash: newHash, passwordHistory: newHistory, passwordChangedAt: new Date() })
      .where(eq(schema.users.id, ctx.userId));

    // 失效所有会话（含当前），强制重新登录（NFR-SEC-13）
    // 关键安全操作必须 await（Redis 不可达时撤销失败会留下有效旧 Token）
    try {
      await revokeUserAccessByUserId(ctx.userId);
    } catch (e) {
      log.error('改密后撤销会话失败', { error: (e as Error).message });
    }

    return { success: true, data: { id: ctx.userId }, message: '密码已更新，请重新登录' };
  },
);
