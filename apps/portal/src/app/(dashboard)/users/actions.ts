'use server';

/**
 * 用户管理 Server Actions (BFF 薄 Controller — 仅写操作)
 *
 * 只读查询统一收拢至 data.ts（读模型 / CQRS），本文件仅保留 CUD 写操作。
 * 仅执行编排 (Orchestration)：Zod 门禁 → 领域纯函数 → Drizzle 直调。
 * 鉴权与领域错误映射统一由 withAuth 高阶函数施加（R21 / R20），
 * 函数体控制在 ≤ 20 行，不含任何内联业务规则判定（R9 / 红线 #2）。
 * 涉及"读取 + 更新"的多步骤写操作均经 lib/authz 的 withScopedRow / withScopedWrite
 * 在同一事务内完成（R22 / ADR-014）。
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
import { EntityNotFoundError, DuplicateEntityError , BusinessRuleViolationError } from '@/domain/shared/errors';
import { generateUUID } from '@/lib/crypto';
import { validate } from '@/lib/validation';
import { hashPassword } from '@/domain/auth/password';
import {
  refreshAuthorizationCache,
  revokeAndRefreshAuthorization,
} from '@/lib/auth/authorization-effects';
import { revokeUserAccessByUserId } from '@/lib/session/revoke';
import { clearBruteForceCounter } from '@/lib/auth/brute-force';
import { invalidateResource } from '@/lib/cache-invalidation';
import { withScopedRow, withScopedWrite } from '@/lib/authz';
import type { DbTxHandle } from '@/infrastructure/db';
import { assertResetAllowed, revokeAfterPasswordReset } from '@/lib/account/reset-password';
import { nextPasswordHistory } from '@/domain/auth/password-change';

/**
 * 事务内加载目标用户行并施加数据范围守卫。
 *
 * 抽取理由是**正确性而非行数**：这份守卫配置（授权到 `deptId`、越界消息、
 * 404 语义）原先在本文件里逐字重复 3 处。安全配置散落时，改一处而漏改另一处
 * 就是越权——收成一处才能保证「改则全改」。`selectColumns` 供只需要密码字段的
 * 场景收窄列（其余场景默认全列）。
 */
function loadUserScoped(
  operatorId: string,
  userId: string,
  selectColumns?: { id?: true; deptId?: true; passwordHash?: true; passwordHistory?: true },
) {
  return {
    operatorId,
    load: (tx: DbTxHandle) =>
      tx.query.users.findFirst({
        where: eq(schema.users.id, userId),
        ...(selectColumns ? { columns: selectColumns } : {}),
      }),
    deptOf: (row: { deptId: string | null }) => row.deptId,
    message: '无权操作该部门的用户',
    notFound: () => new EntityNotFoundError('User', userId),
  };
}
import { COMMON_ERRORS, USER_ACTIVE, USER_ERRORS, USER_PERMISSIONS } from '@auth-sso/contracts';
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

    // 范围守卫 + 查重 + 插入同一事务（消除 TOCTOU，ADR-014）。
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

    // 加载行 → 404 → 数据范围守卫，三步同一事务（消除 TOCTOU，ADR-014）
    const updated = await withScopedRow(
      loadUserScoped(ctx.userId, v.data.id),
      async (tx, row) => {
        const target = toggleUserStatus(userFromPersistence(row));
        // `USER_ERRORS.CANNOT_DISABLE_SELF` 对应的规则（此前从未实现）：
        // 只拦"把自己禁用"；自己处于禁用态时再启用是自救，必须允许。
        if (v.data.id === ctx.userId && target.status !== USER_ACTIVE) {
          throw new BusinessRuleViolationError('不能禁用自己的账号', USER_ERRORS.CANNOT_DISABLE_SELF);
        }
        await tx.update(schema.users)
          .set({ status: target.status })
          .where(eq(schema.users.id, v.data.id));
        return target;
      },
    );

    // 状态变更后撤销该用户所有活跃 JWT（jti 黑名单），确保变更即时生效。
    // 关键安全操作必须 await；但 ADR-011 分级下 Redis 故障不阻断本次状态变更
    // （AT 会在 ≤1h 内自然过期），失败由 lib/session/revoke 记日志（含 userId），
    // 故此处刻意不写 catch——此前那个 catch 不可达。
    await revokeUserAccessByUserId(v.data.id);

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
      loadUserScoped(ctx.userId, v.data.id),
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
    // 范围快照取自本事务（ADR-014）；deptId 未变更时不追加迁移目标。
    let deptIdChanged = false;
    await withScopedRow(
      {
        ...loadUserScoped(ctx.userId, v.data.id),
        // 第二个目标：拟迁入部门（同一份快照，不重复读取）
        extraTargets: () => v.data.deptId
          ? [{ deptId: v.data.deptId, message: '无权将用户迁移至该部门' }]
          : [],
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
    // 部门归属变了 ⇒ 权限决策变了（数据范围随之变化）→ 撤销 AT + 刷缓存；
    // 否则只是改名/邮箱一类不改变决策的变更 → 只刷缓存
    if (deptIdChanged) {
      await revokeAndRefreshAuthorization([v.data.id]);
    } else {
      await refreshAuthorizationCache([v.data.id]);
    }
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

    // `USER_ERRORS.CANNOT_DELETE_SELF` 对应的规则（契约里定义了但此前**从未实现**）：
    // 允许管理员删除自己会造成自锁死（尤其当他是最后一个管理员）。
    if (v.data.id === ctx.userId) {
      throw new BusinessRuleViolationError('不能删除自己的账号', USER_ERRORS.CANNOT_DELETE_SELF);
    }

    await withScopedRow(
      loadUserScoped(ctx.userId, v.data.id),
      async (tx, row) => {
        const deleted = deleteUser(userFromPersistence(row));
        await tx.update(schema.users)
          .set({ status: deleted.status })
          .where(eq(schema.users.id, v.data.id));
      },
    );

    // 逻辑删除使该用户失去全部角色 ⇒ 权限决策变更 → 收敛（撤销 AT + 刷缓存）
    await revokeAndRefreshAuthorization([v.data.id]);
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
    const passwordHash = await hashPassword(newPassword);

    // 复用本文件唯一的守卫工厂（`selectColumns` 正是为"只取密码字段"这一场景提供的）
    await withScopedRow(
      loadUserScoped(ctx.userId, v.data.id, {
        id: true,
        deptId: true,
        passwordHash: true,
        passwordHistory: true,
      }),
      async (tx, row) => {
        const state = {
          currentHash: row.passwordHash ?? null,
          history: row.passwordHistory ?? null,
        };
        // NFR-SEC-15: 禁止重用最近 5 次密码（领域判定与自助改密共用）
        await assertResetAllowed(newPassword, state);
        await tx.update(schema.users)
          .set({ passwordHash, passwordHistory: nextPasswordHistory(state) })
          .where(eq(schema.users.id, v.data.id));
      },
    );

    // 重置后所有会话失效，用户须用新密码重新登录（B-USR-PW）
    await revokeAfterPasswordReset(v.data.id);

    invalidateResource('users');
    return { success: true, data: { id: v.data.id }, message: '密码已重置，该用户所有会话已失效' };
  },
);
