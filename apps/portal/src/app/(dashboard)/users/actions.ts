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
import { RoleAssignmentSchema, assignUserRoles } from '@/lib/user-role-assignment';
import { invalidateResource } from '@/lib/cache-invalidation';
import { clearUserBruteForceCounters } from '@/lib/auth/brute-force';
import { and, eq, isNull, or } from 'drizzle-orm';
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
import { recordActionAuditDetail } from '@/lib/audit';

import { withScopedRow, withScopedWrite, withGlobalWrite } from '@/lib/authz';
import { assertDepartmentUsable } from '@/lib/department-availability';
import type { DbTxHandle } from '@/infrastructure/db';
import {
  assertResetAllowed,
  revokeAccessTokensAfterReset,
  revokeRefreshTokensForReset,
} from '@/lib/account/reset-password';
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
import { USER_ACTIVE, USER_ERRORS, USER_PERMISSIONS } from '@auth-sso/contracts';
import type { ApiResponse } from '@auth-sso/contracts';

/**
 * 创建新用户 Action Controller
 *
 * 支持两种调用签名：
 * - 直接传参：createUserAction(input)
 * - React 19 Form Action：createUserAction(null, formData)
 */
export const createUserAction = withAuth(
  { permissions: [USER_PERMISSIONS.CREATE] },
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
    // deptId 有值时：目标部门必须在操作者范围内；deptId 为空是历史遗留的"无部门用户"，
    // 属于全局资源写——走具名 `withGlobalWrite`（操作者仍须有非空数据范围），
    // 不再用 `targets: []` 静默关闭守卫（ADR-028）。是否允许无部门用户仍是产品决策（Q2）。
    const createUserInTx = async (tx: DbTxHandle) => {
      // 只看**未删除**行：与 `ux_users_email` / `ux_users_mobile` 的部分唯一索引同口径
      // （`WHERE deleted_at IS NULL`）。用户名没有部分索引（完整唯一约束），
      // 因此软删除用户的用户名仍会被数据库挡住并映射为 `USERNAME_ALREADY_EXISTS`。
      const existing = await tx.query.users.findFirst({
        where: and(
          or(eq(schema.users.username, v.data.username), eq(schema.users.email, v.data.email)),
          isNull(schema.users.deletedAt),
        ),
        columns: { username: true, email: true },
      });
      if (existing) {
        // 一次查询即可，但要**分别报码**：客户端表单需要定位到具体输入框（#82）
        const usernameTaken = existing.username === v.data.username;
        throw new DuplicateEntityError(
          'User',
          usernameTaken ? 'username' : 'email',
          usernameTaken
            ? USER_ERRORS.USERNAME_ALREADY_EXISTS
            : USER_ERRORS.EMAIL_ALREADY_EXISTS,
        );
      }

      const user = createUser(v.data, generateUUID);
      await tx.insert(schema.users).values({
        ...userToInsertRow(user),
        passwordHash,
      });
      return user;
    };

    const result = v.data.deptId
      ? await withScopedWrite(
          {
            operatorId: ctx.userId,
            targets: [{ deptId: v.data.deptId, message: '无权在指定部门下创建用户' }],
            // H-23：部门必须存在且 ACTIVE（禁用部门不接收新用户）；存在性先于范围判定
            preflight: (tx: DbTxHandle) => assertDepartmentUsable(tx, v.data.deptId!, '在该部门下创建用户'),
          },
          createUserInTx,
        )
      : await withGlobalWrite(
          { operatorId: ctx.userId, resource: '无部门用户' },
          createUserInTx,
        );

    invalidateResource('users');
    // 创建事件也要能按目标用户追溯：referer 只有 /users，显式记录 targetUserId/url。
    await recordActionAuditDetail(ctx.userId, 'USER_CREATE', {
      url: `/users/${result.id}`,
      params: { targetUserId: result.id, username: v.data.username },
    });
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
      await clearUserBruteForceCounters(v.data.id);
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
    let statusChanged = false;
    await withScopedRow(
      {
        ...loadUserScoped(ctx.userId, v.data.id),
        // H-24：deptId=null 是"历史/引导态"的非法数据，`isWithinScope(null)` 恒拒会让
        // 管理员连"补部门"这条修复路径都无法执行（update/toggle/assign role 全 403）。
        // 受控例外：仅当目标是**无部门**用户且本次为它指定部门时，用**拟落入部门**参与
        // 范围断言（仍要求操作者范围包含该部门；其余情况保持 fail-closed）。
        deptOf: (row: { deptId: string | null }) => row.deptId ?? v.data.deptId ?? null,
        // 第二个目标：拟迁入部门（同一份快照，不重复读取）
        extraTargets: () => v.data.deptId
          ? [{ deptId: v.data.deptId, message: '无权将用户迁移至该部门' }]
          : [],
      },
      async (tx, row) => {
        // H-24：禁止把已有部门的用户清空——会主动制造上面那种"谁都改不了"的死锁状态。
        if (row.deptId !== null && v.data.deptId === null) {
          throw new BusinessRuleViolationError(
            '不能清空用户所属部门（用户将失去数据范围归属，且管理员无法再编辑该用户）',
          );
        }
        const nextDeptId = v.data.deptId;
        const deptChanged = hasDeptChanged(row.deptId, v.data.deptId);
        // H-23：迁入部门必须存在且 ACTIVE（禁用部门是生命周期门禁）
        if (deptChanged && nextDeptId) {
          await assertDepartmentUsable(tx, nextDeptId, '将用户迁移至该部门');
        }
        // H-25（users 侧不变量，与 roles 侧「有绑定用户不得迁部门」对称）：
        // 迁部门前必须保证该用户现有角色都属于新部门（R-USER-ROLE），否则 422 提示先解除角色。
        if (deptChanged && nextDeptId) {
          const bound = await tx.query.userRoles.findMany({
            where: eq(schema.userRoles.userId, v.data.id),
            with: { role: { columns: { id: true, code: true, deptId: true } } },
          });
          const incompatible = bound.filter(
            (b): b is typeof b & { role: NonNullable<typeof b.role> } =>
              b.role !== null && b.role.deptId !== nextDeptId,
          );
          if (incompatible.length > 0) {
            throw new BusinessRuleViolationError(
              `该用户已绑定其他部门的角色（${incompatible.map((b) => b.role.code).join('、')}），请先解除角色后再迁移部门`,
            );
          }
        }
        const updated = applyUserUpdate(userFromPersistence(row), {
          name: v.data.name, email: v.data.email,
          status: v.data.status, deptId: v.data.deptId,
          avatarUrl: v.data.avatarUrl,
        });
        deptIdChanged = deptChanged;
        statusChanged = row.status !== updated.status;
        await tx.update(schema.users).set(userToUpdateRow(updated))
          .where(eq(schema.users.id, v.data.id));
      },
    );
    // 状态或部门变了 ⇒ 权限/会话决策变了 → 撤销 AT + 刷缓存（H-17：此前直写 status
    // 不撤 AT，被禁用/锁定用户的既有 Access Token 仍可用至自然过期）；
    // 否则只是改名/邮箱一类不改变决策的变更 → 只刷缓存
    if (deptIdChanged || statusChanged) {
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
        // **用领域映射写回全部可变列**（而非只手写 status）：`deleteUser` 会算出的
        // `deletedAt` 此前被丢弃 ⇒ `deleted_at` 永远为 NULL ⇒ schema 的
        // **部分唯一索引**（`WHERE deleted_at IS NULL`）永不释放被删用户的
        // 邮箱/手机号，「软删除后可复用」的设计意图完全失效（#86）。
        await tx.update(schema.users)
          .set(userToUpdateRow(deleted))
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
      // 专属码：客户端据此把错误定位到"新密码"输入框并展示强度要求（#82）
      return { success: false, error: USER_ERRORS.PASSWORD_TOO_WEAK, message: passwordError };
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
        // H-13：RT 撤销与密码写入**同一事务**（fail-close）——撤销失败则整体回滚，
        // 不产生"密码已改但旧 RT 仍可续期"的部分成功。
        await revokeRefreshTokensForReset(tx, v.data.id);
      },
    );

    // jti 层（尽力而为，ADR-011）：失败不阻断已提交的重置，由 lib/session/revoke 记日志。
    await revokeAccessTokensAfterReset(v.data.id);

    invalidateResource('users');
    return { success: true, data: { id: v.data.id }, message: '密码已重置，该用户所有会话已失效' };
  },
);

/**
 * 分配用户角色（**内部页面写操作的唯一入口**）
 *
 * 与 REST 路由共用 `lib/user-role-assignment` 的**同一份**写编排与**同一份** zod schema：
 * 范围守卫、事务内校验（R-USER-ROLE）、删旧插新、安全审计、权限收敛都在那里，本函数只做
 * 三件事——鉴权（{@link withAuth}）、调共享实现、用 **Action 版**入口失效缓存
 * （route 用 `invalidateResourceFromRoute`，两者不可混用，见 `cache-invalidation-site-guard`）。
 *
 * 为什么不是手写一遍编排：那是同一件事两种形状，正是 `lib/authz` 当初要消灭的形态。
 */
export const updateUserRolesAction = withAuth(
  { permissions: [USER_PERMISSIONS.ASSIGN_ROLE] },
  async (
    ctx: AuthContext,
    targetUserId: string,
    roleIds: string[],
  ): Promise<ApiResponse<{ assignedCount: number }>> => {
    const v = validate(RoleAssignmentSchema, { roleIds });
    if (!v.ok) return v.response;

    // 共享实现已完成权限收敛（撤销 AT + 刷权限缓存）；失败带可直接进信封的码/消息
    const result = await assignUserRoles(ctx.userId, targetUserId, v.data.roleIds, {
      method: 'POST',
      url: `/users/${targetUserId}`,
      ip: null,
      userAgent: null,
    });
    if (!result.ok) return { success: false, error: result.error, message: result.message };

    invalidateResource('users');
    return { success: true, data: { assignedCount: result.assignedCount.length } };
  },
);
