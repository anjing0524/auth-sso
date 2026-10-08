'use server';

/**
 * 用户管理 Server Actions (BFF 薄 Controller — 仅写操作)
 *
 * 只读查询统一收拢至 data.ts（读模型 / CQRS），本文件仅保留 CUD 写操作。
 * 仅执行编排 (Orchestration)：Zod 门禁 → 领域纯函数 → Drizzle 直调。
 * 鉴权与领域错误映射统一由 withAuth 高阶函数施加（R21 / R20），
 * 函数体控制在 ≤ 20 行，不含任何内联业务规则判定（R9 / 红线 #2）。
 * 涉及"读取 + 更新"的多步骤写操作均经 lib/authz 的 withScopedRow / withScopedWrite
 * 在同一事务内完成（R22 / ADR-019）。
 *
 * @impl B-USR-C — 新建用户
 * @impl B-USR-U — 编辑用户资料
 * @impl B-USR-D — 删除用户（逻辑删除）
 * @impl B-USR-ST — 账户状态管理
 * @impl B-USR-PW — 重置用户密码
 */
import { schema } from '@/infrastructure/db';
import { eq, or } from 'drizzle-orm';
import { withAuth, type AuthContext } from '@/lib/auth';
import {
  createUser,
  toggleUserStatus,
  unlockUser,
  deleteUser,
  applyUserUpdate,
  hasDeptChanged,
  userFromPersistence,
  userToInsertRow,
  userToUpdateRow,
} from '@/domain/user/user';
import {
  CreateUserInputSchema,
  UpdateUserInputSchema,
  UserIdentityInputSchema,
  type CreateUserInput,
} from '@/domain/user/types';
import { validatePassword } from '@/domain/shared/zod-schemas';
import { EntityNotFoundError, DuplicateEntityError } from '@/domain/shared/errors';
import { generateUUID } from '@/lib/crypto';
import { validate } from '@/lib/validation';
import { hashPassword } from '@/domain/auth/password';
import { refreshUserPermissionCache } from '@/lib/permissions';
import { revokeUserAccessByUserId } from '@/lib/session/revoke';
import { clearBruteForceCounter } from '@/lib/auth/brute-force';
import { createLogger } from '@/lib/logger';
import { invalidateResource } from '@/lib/cache-invalidation';
import { withScopedRow, withScopedWrite } from '@/lib/authz';
import {
  assertResetAllowed,
  buildPasswordHistory,
  hashNewPassword,
  revokeAfterPasswordReset,
} from '@/lib/account/reset-password';

const log = createLogger('UsersAction');
import { COMMON_ERRORS, USER_ACTIVE, USER_PERMISSIONS } from '@auth-sso/contracts';
import type { ApiResponse } from '@auth-sso/contracts';

/**
 * 创建新用户 Action Controller
 *
 * 支持两种调用签名：
 * - 直接传参：createUserAction(input)
 * - React 19 Form Action：createUserAction(null, formData)
 */
export const createUserAction = withAuth(
  { permissions: [USER_PERMISSIONS.CREATE], audit: 'USER_CREATE' },
  async (
    ctx: AuthContext,
    firstArg: CreateUserInput | null | undefined,
    secondArg?: FormData,
  ): Promise<ApiResponse<{ id: string }>> => {
    // 兼容双签名：FormData 模式时从 FormData 提取原始字段
    const rawInput = secondArg !== undefined ? Object.fromEntries(secondArg) : firstArg;
    const v = validate(CreateUserInputSchema, rawInput);
    if (!v.ok) return v.response;

    // 密码哈希在事务外完成，避免长时间占用 DB 连接（bcrypt 通常 50-200ms）
    const passwordHash = await hashPassword(v.data.password);

    // 范围守卫 + 查重 + 插入同一事务（消除 TOCTOU，ADR-019）。
    // deptId 已在 Zod .preprocess() 中归一化 ('ALL' → null)，Controller 层不重复判定；
    // deptId 为 null 时 targets 为空数组，守卫不构成限制（与既有语义一致）。
    const result = await withScopedWrite(
      {
        operatorId: ctx.userId,
        targets: v.data.deptId
          ? [{ deptId: v.data.deptId, message: '无权在指定部门下创建用户' }]
          : [],
      },
      async (tx) => {
        const existing = await tx.query.users.findFirst({
          where: or(eq(schema.users.username, v.data.username), eq(schema.users.email, v.data.email)),
        });
        if (existing) throw new DuplicateEntityError('User', 'username/email');

        const user = createUser(v.data, generateUUID);
        await tx.insert(schema.users).values({
          ...userToInsertRow(user),
          passwordHash,
        });
        return user;
      },
    );

    invalidateResource('users');
    return { success: true, data: { id: result.id }, message: '用户创建成功' };
  },
);

/**
 * 切换用户启用/禁用状态 Action Controller
 */
export const toggleUserStatusAction = withAuth(
  { permissions: [USER_PERMISSIONS.UPDATE], audit: 'USER_UPDATE' },
  async (ctx: AuthContext, userIdStr: string): Promise<ApiResponse<{ status: string }>> => {
    const v = validate(UserIdentityInputSchema, { id: userIdStr });
    if (!v.ok) return v.response;

    // 加载行 → 404 → 数据范围守卫，三步同一事务（消除 TOCTOU，ADR-019）
    const updated = await withScopedRow(
      {
        operatorId: ctx.userId,
        load: (tx) => tx.query.users.findFirst({ where: eq(schema.users.id, v.data.id) }),
        deptOf: (row) => row.deptId,
        message: '无权操作该部门的用户',
        notFound: () => new EntityNotFoundError('User', v.data.id),
      },
      async (tx, row) => {
        const target = toggleUserStatus(userFromPersistence(row));
        await tx.update(schema.users)
          .set({ status: target.status })
          .where(eq(schema.users.id, v.data.id));
        return target;
      },
    );

    // 状态变更后撤销该用户所有活跃 JWT（jti 黑名单），确保变更即时生效
    // 关键安全操作必须 await（Redis 不可达时撤销失败会留下有效旧 Token）
    try {
      await revokeUserAccessByUserId(v.data.id);
    } catch (e) {
      log.error('撤销用户 JWT 失败', { error: (e as Error).message });
    }

    invalidateResource('users');
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
  { permissions: [USER_PERMISSIONS.UPDATE], audit: 'USER_UPDATE' },
  async (ctx: AuthContext, userIdStr: string): Promise<ApiResponse<{ status: string }>> => {
    const v = validate(UserIdentityInputSchema, { id: userIdStr });
    if (!v.ok) return v.response;

    const updated = await withScopedRow(
      {
        operatorId: ctx.userId,
        load: (tx) => tx.query.users.findFirst({ where: eq(schema.users.id, v.data.id) }),
        deptOf: (row) => row.deptId,
        message: '无权操作该部门的用户',
        notFound: () => new EntityNotFoundError('User', v.data.id),
      },
      async (tx, row) => {
        const target = unlockUser(userFromPersistence(row));
        await tx.update(schema.users)
          .set({ status: target.status })
          .where(eq(schema.users.id, v.data.id));
        return target;
      },
    );

    invalidateResource('users');

    // 清除暴力破解 Redis 计数器（管理员解锁需同步清除，否则窗口期内仍被锁定）
    try {
      await clearBruteForceCounter(v.data.id);
    } catch {
      // 清除失败不阻塞解锁操作
    }

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
  { permissions: [USER_PERMISSIONS.UPDATE], audit: 'USER_UPDATE' },
  async (
    ctx: AuthContext,
    userIdStr: string,
    input: Record<string, unknown>,
  ): Promise<ApiResponse<{ id: string }>> => {
    const v = validate(UpdateUserInputSchema, { id: userIdStr, ...input });
    if (!v.ok) return v.response;

    // 双目标守卫：目标用户**当前**部门 + 拟**迁入**部门都必须在操作者范围内。
    // 快照取自授权码行同事务（ADR-019）；deptId 未变更时不追加迁移目标。
    let deptIdChanged = false;
    await withScopedRow(
      {
        operatorId: ctx.userId,
        load: (tx) => tx.query.users.findFirst({ where: eq(schema.users.id, v.data.id) }),
        deptOf: (row) => row.deptId,
        message: '无权操作该部门的用户',
        // 第二个目标：拟迁入部门（同一份快照，不重复读取）
        extraTargets: () => v.data.deptId
          ? [{ deptId: v.data.deptId, message: '无权将用户迁移至该部门' }]
          : [],
        notFound: () => new EntityNotFoundError('User', v.data.id),
      },
      async (tx, row) => {
        const updated = applyUserUpdate(userFromPersistence(row), {
          name: v.data.name, email: v.data.email,
          status: v.data.status, deptId: v.data.deptId,
          avatarUrl: v.data.avatarUrl,
        });
        deptIdChanged = hasDeptChanged(row.deptId, v.data.deptId);
        await tx.update(schema.users).set(userToUpdateRow(updated))
          .where(eq(schema.users.id, v.data.id));
      },
    );
    await refreshUserPermissionCache(v.data.id);
    if (deptIdChanged) await revokeUserAccessByUserId(v.data.id);
    invalidateResource('users');
    return { success: true, data: { id: v.data.id }, message: '更新成功' };
  },
);

/**
 * 逻辑删除用户 Action Controller
 */
export const deleteUserAction = withAuth(
  { permissions: [USER_PERMISSIONS.DELETE], audit: 'USER_DELETE' },
  async (ctx: AuthContext, userIdStr: string): Promise<ApiResponse<{ id: string }>> => {
    const v = validate(UserIdentityInputSchema, { id: userIdStr });
    if (!v.ok) return v.response;

    await withScopedRow(
      {
        operatorId: ctx.userId,
        load: (tx) => tx.query.users.findFirst({ where: eq(schema.users.id, v.data.id) }),
        deptOf: (row) => row.deptId,
        message: '无权操作该部门的用户',
        notFound: () => new EntityNotFoundError('User', v.data.id),
      },
      async (tx, row) => {
        const deleted = deleteUser(userFromPersistence(row));
        await tx.update(schema.users)
          .set({ status: deleted.status })
          .where(eq(schema.users.id, v.data.id));
      },
    );

    // 删除用户后撤销其所有活跃 JWT（jti 黑名单），确保即时下线
    // 关键安全操作必须 await（Redis 不可达时撤销失败会留下有效旧 Token）
    try {
      await revokeUserAccessByUserId(v.data.id);
    } catch (e) {
      log.error('撤销已删除用户 JWT 失败', { error: (e as Error).message });
    }

    await refreshUserPermissionCache(v.data.id);
    invalidateResource('users');
    return { success: true, data: { id: v.data.id }, message: '用户已逻辑删除' };
  },
);

/**
 * 重置用户密码 Action Controller (B-USR-PW)
 *
 * 管理员为指定用户重置密码，重置后该用户所有活跃会话立即失效。
 */
export const resetPasswordAction = withAuth(
  { permissions: [USER_PERMISSIONS.RESET_PASSWORD], audit: 'TOKEN_REVOKE' },
  async (ctx: AuthContext, userIdStr: string, newPassword: string): Promise<ApiResponse<{ id: string }>> => {
    const v = validate(UserIdentityInputSchema, { id: userIdStr });
    if (!v.ok) return v.response;
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return { success: false, error: COMMON_ERRORS.VALIDATION_ERROR, message: passwordError };
    }

    // bcrypt 在作用域外完成：约 50–200ms，放进事务会长时间占用 DB 连接
    const passwordHash = await hashNewPassword(newPassword);

    await withScopedRow(
      {
        operatorId: ctx.userId,
        load: (tx) => tx.query.users.findFirst({
          where: eq(schema.users.id, v.data.id),
          columns: { id: true, deptId: true, passwordHash: true, passwordHistory: true },
        }),
        deptOf: (row) => row.deptId,
        message: '无权操作该部门的用户',
        notFound: () => new EntityNotFoundError('User', v.data.id),
      },
      async (tx, row) => {
        const state = {
          currentHash: row.passwordHash ?? null,
          history: row.passwordHistory ?? null,
        };
        // NFR-SEC-15: 禁止重用最近 5 次密码（领域判定与自助改密共用）
        await assertResetAllowed(newPassword, state);
        await tx.update(schema.users)
          .set({ passwordHash, passwordHistory: buildPasswordHistory(state) })
          .where(eq(schema.users.id, v.data.id));
      },
    );

    // 重置后所有会话失效，用户须用新密码重新登录（B-USR-PW）
    await revokeAfterPasswordReset(v.data.id);

    invalidateResource('users');
    return { success: true, data: { id: v.data.id }, message: '密码已重置，该用户所有会话已失效' };
  },
);
