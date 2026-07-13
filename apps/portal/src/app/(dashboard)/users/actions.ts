'use server';

/**
 * 用户管理 Server Actions (BFF 薄 Controller — 仅写操作)
 *
 * 只读查询统一收拢至 data.ts（读模型 / CQRS），本文件仅保留 CUD 写操作。
 * 仅执行编排 (Orchestration)：Zod 门禁 → 领域纯函数 → Drizzle 直调。
 * 鉴权与领域错误映射统一由 withAuth 高阶函数施加（R21 / R20），
 * 函数体控制在 ≤ 20 行，不含任何内联业务规则判定（R9 / 红线 #2）。
 * 涉及“读取 + 更新”的多步骤写操作均用 db.transaction() 显式包裹（R22）。
 */
import { revalidatePath, updateTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, or } from 'drizzle-orm';
import { withAuth, type AuthContext } from '@/lib/auth';
import {
  createUser,
  toggleUserStatus,
  unlockUser,
  deleteUser,
  applyUserUpdate,
  toDomainUser,
  userToInsertRow,
  userToUpdateRow,
  hasDeptChanged,
} from '@/domain/user/user';
import {
  CreateUserInputSchema,
  UpdateUserInputSchema,
  UserIdentityInputSchema,
  type CreateUserInput,
} from '@/domain/user/types';
import { validatePassword } from '@/domain/shared/zod-schemas';
import { EntityNotFoundError, DuplicateEntityError, ForbiddenError, BusinessRuleViolationError } from '@/domain/shared/errors';
import { generateUUID } from '@/lib/crypto';
import { hashPassword, isPasswordReused, pushPasswordHistory } from '@/domain/auth/password';
import { refreshUserPermissionCache } from '@/lib/permissions';
import { revokeUserAccessByUserId } from '@/lib/session/revoke';
import { canAccessDept } from '@/lib/auth';
import { USER_ACTIVE } from '@auth-sso/contracts';
import type { ApiResponse } from '@auth-sso/contracts';

/**
 * 创建新用户 Action Controller
 *
 * 支持两种调用签名：
 * - 直接传参：createUserAction(input)
 * - React 19 Form Action：createUserAction(null, formData)
 */
export const createUserAction = withAuth(
  { permissions: ['user:create'], audit: 'USER_CREATE' },
  async (
    ctx: AuthContext,
    firstArg: CreateUserInput | null | undefined,
    secondArg?: FormData,
  ): Promise<ApiResponse<{ id: string }>> => {
    // 兼容双签名：FormData 模式时从 FormData 提取原始字段
    const rawInput = secondArg !== undefined ? Object.fromEntries(secondArg) : firstArg;
    const parsed = CreateUserInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0]!.message };
    }

    // 数据范围校验：目标部门必须在操作者可访问范围内（R7 / H-ACL-002）
    if (parsed.data.deptId && !canAccessDept(ctx.claims.deptIds, parsed.data.deptId)) {
      throw new ForbiddenError('无权在指定部门下创建用户');
    }

    // 密码哈希在事务外完成，避免长时间占用 DB 连接（bcrypt 通常 50-200ms）
    const passwordHash = await hashPassword(parsed.data.password);

    // 查重 + 插入在事务中原子完成（R22）
    // deptId 已在 Zod .preprocess() 中归一化 ('ALL' → null)，Controller 层不重复判定
    const result = await db.transaction(async (tx) => {
      const existing = await tx.query.users.findFirst({
        where: or(eq(schema.users.username, parsed.data.username), eq(schema.users.email, parsed.data.email)),
      });
      if (existing) throw new DuplicateEntityError('User', 'username/email');

      const user = createUser(parsed.data, generateUUID);
      await tx.insert(schema.users).values({
        ...userToInsertRow(user),
        passwordHash,
      });
      return user;
    });

    revalidatePath('/users');
    updateTag('users-list');
    return { success: true, data: { id: result.id }, message: '用户创建成功' };
  },
);

/**
 * 切换用户启用/禁用状态 Action Controller
 */
export const toggleUserStatusAction = withAuth(
  { permissions: ['user:update'], audit: 'USER_UPDATE' },
  async (ctx: AuthContext, userIdStr: string): Promise<ApiResponse<{ status: string }>> => {
    const parsed = UserIdentityInputSchema.safeParse({ id: userIdStr });
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0]!.message };
    }

    // 读取 + 更新在事务中原子完成（R22）
    const updated = await db.transaction(async (tx) => {
      const row = await tx.query.users.findFirst({ where: eq(schema.users.id, parsed.data.id) });
      if (!row) throw new EntityNotFoundError('User', parsed.data.id);
      // 数据范围校验：目标用户部门必须在操作者可访问范围内（R7 / H-ACL-002）
      if (!canAccessDept(ctx.claims.deptIds, row.deptId)) throw new ForbiddenError('无权操作该部门的用户');

      const target = toggleUserStatus(toDomainUser(row));
      await tx.update(schema.users)
        .set({ status: target.status })
        .where(eq(schema.users.id, parsed.data.id));
      return target;
    });

    // 状态变更后撤销该用户所有活跃 JWT（jti 黑名单），确保变更即时生效
    // 关键安全操作必须 await（Redis 不可达时撤销失败会留下有效旧 Token）
    try {
      await revokeUserAccessByUserId(parsed.data.id);
    } catch (e) {
      console.error('[Users Action] 撤销用户 JWT 失败:', e);
    }

    revalidatePath('/users');
    updateTag('users-list');
    return {
      success: true,
      data: { status: updated.status },
      message: `用户状态已更新为 ${updated.status === USER_ACTIVE ? '正常' : '已禁用'}`,
    };
  },
);

/**
 * 解锁被锁定用户 Action Controller (B-USR-ST)
 */
export const unlockUserAction = withAuth(
  { permissions: ['user:update'], audit: 'USER_UPDATE' },
  async (ctx: AuthContext, userIdStr: string): Promise<ApiResponse<{ status: string }>> => {
    const parsed = UserIdentityInputSchema.safeParse({ id: userIdStr });
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0]!.message };
    }

    const updated = await db.transaction(async (tx) => {
      const row = await tx.query.users.findFirst({ where: eq(schema.users.id, parsed.data.id) });
      if (!row) throw new EntityNotFoundError('User', parsed.data.id);
      if (!canAccessDept(ctx.claims.deptIds, row.deptId)) throw new ForbiddenError('无权操作该部门的用户');

      const target = unlockUser(toDomainUser(row));
      await tx.update(schema.users)
        .set({ status: target.status })
        .where(eq(schema.users.id, parsed.data.id));
      return target;
    });

    revalidatePath('/users');
    updateTag('users-list');
    return {
      success: true,
      data: { status: updated.status },
      message: '用户已解锁',
    };
  },
);

/**
 * 更新用户信息 Action Controller
 */
export const updateUserAction = withAuth(
  { permissions: ['user:update'], audit: 'USER_UPDATE' },
  async (
    ctx: AuthContext,
    userIdStr: string,
    input: Record<string, unknown>,
  ): Promise<ApiResponse<{ id: string }>> => {
    const parsed = UpdateUserInputSchema.safeParse({ id: userIdStr, ...input });
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0]!.message };
    }

    let deptIdChanged = false;
    await db.transaction(async (tx) => {
      const row = await tx.query.users.findFirst({ where: eq(schema.users.id, parsed.data.id) });
      if (!row) throw new EntityNotFoundError('User', parsed.data.id);
      // 校验目标用户当前部门 + 拟变更目标部门均在操作者可访问范围内
      if (!canAccessDept(ctx.claims.deptIds, row.deptId)) throw new ForbiddenError('无权操作该部门的用户');
      if (parsed.data.deptId && !canAccessDept(ctx.claims.deptIds, parsed.data.deptId)) {
        throw new ForbiddenError('无权将用户迁移至该部门');
      }

      const updated = applyUserUpdate(toDomainUser(row), {
        name: parsed.data.name, email: parsed.data.email,
        status: parsed.data.status, deptId: parsed.data.deptId,
        avatarUrl: parsed.data.avatarUrl,
      });
      deptIdChanged = hasDeptChanged(row.deptId, parsed.data.deptId);
      await tx.update(schema.users).set(userToUpdateRow(updated)).where(eq(schema.users.id, parsed.data.id));
    });
    await refreshUserPermissionCache(parsed.data.id);
    if (deptIdChanged) await revokeUserAccessByUserId(parsed.data.id);
    revalidatePath('/users');
    updateTag('users-list');
    return { success: true, data: { id: parsed.data.id }, message: '更新成功' };
  },
);

/**
 * 逻辑删除用户 Action Controller
 */
export const deleteUserAction = withAuth(
  { permissions: ['user:delete'], audit: 'USER_DELETE' },
  async (ctx: AuthContext, userIdStr: string): Promise<ApiResponse<{ id: string }>> => {
    const parsed = UserIdentityInputSchema.safeParse({ id: userIdStr });
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0]!.message };
    }

    // 读取 + 更新在事务中原子完成（R22）；领域纯函数执行删除规则校验
    await db.transaction(async (tx) => {
      const row = await tx.query.users.findFirst({ where: eq(schema.users.id, parsed.data.id) });
      if (!row) throw new EntityNotFoundError('User', parsed.data.id);
      if (!canAccessDept(ctx.claims.deptIds, row.deptId)) throw new ForbiddenError('无权操作该部门的用户');

      const deleted = deleteUser(toDomainUser(row));
      await tx.update(schema.users)
        .set({ status: deleted.status })
        .where(eq(schema.users.id, parsed.data.id));
    });

    // 删除用户后撤销其所有活跃 JWT（jti 黑名单），确保即时下线
    // 关键安全操作必须 await（Redis 不可达时撤销失败会留下有效旧 Token）
    try {
      await revokeUserAccessByUserId(parsed.data.id);
    } catch (e) {
      console.error('[Users Action] 撤销已删除用户 JWT 失败:', e);
    }

    await refreshUserPermissionCache(parsed.data.id);
    revalidatePath('/users');
    updateTag('users-list');
    return { success: true, data: { id: parsed.data.id }, message: '用户已逻辑删除' };
  },
);

/**
 * 重置用户密码 Action Controller (B-USR-PW)
 *
 * 管理员为指定用户重置密码，重置后该用户所有活跃会话立即失效。
 */
export const resetPasswordAction = withAuth(
  { permissions: ['user:reset_password'], audit: 'TOKEN_REVOKE' },
  async (ctx: AuthContext, userIdStr: string, newPassword: string): Promise<ApiResponse<{ id: string }>> => {
    const parsed = UserIdentityInputSchema.safeParse({ id: userIdStr });
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0]!.message };
    }
    if (!newPassword) {
      return { success: false, error: 'VALIDATION_ERROR', message: '密码不能为空' };
    }
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return { success: false, error: 'VALIDATION_ERROR', message: passwordError };
    }

    const passwordHash = await hashPassword(newPassword);

    await db.transaction(async (tx) => {
      const row = await tx.query.users.findFirst({ where: eq(schema.users.id, parsed.data.id) });
      if (!row) throw new EntityNotFoundError('User', parsed.data.id);
      if (!canAccessDept(ctx.claims.deptIds, row.deptId)) throw new ForbiddenError('无权操作该部门的用户');

      // NFR-SEC-15: 禁止重用最近 5 次密码
      if (await isPasswordReused(newPassword, row.passwordHistory ?? null)) {
        // 使用 BusinessRuleViolationError 而非原生 Error，确保 mapDomainError 能正确映射错误码
        throw new BusinessRuleViolationError('新密码不能与该用户最近使用过的密码相同');
      }

      const newHistory = pushPasswordHistory(row.passwordHistory ?? null, row.passwordHash ?? '');
      await tx.update(schema.users)
        .set({ passwordHash, passwordHistory: newHistory })
        .where(eq(schema.users.id, parsed.data.id));
    });

    // 重置后所有会话失效，用户须用新密码重新登录（B-USR-PW）
    // 关键安全操作必须 await（Redis 不可达时撤销失败会留下有效旧 Token）
    try {
      await revokeUserAccessByUserId(parsed.data.id);
    } catch (e) {
      console.error('[Users Action] 重置密码后撤销 JWT 失败:', e);
    }

    revalidatePath('/users');
    updateTag('users-list');
    return { success: true, data: { id: parsed.data.id }, message: '密码已重置，该用户所有会话已失效' };
  },
);
