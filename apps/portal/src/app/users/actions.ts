'use server';

/**
 * 用户管理 Server Actions (BFF 薄 Controller 网关)
 *
 * 仅执行编排 (Orchestration)：Zod 门禁 → 领域纯函数 → Drizzle 直调。
 * 鉴权与领域错误映射统一由 withAuth 高阶函数施加（R21 / R20），
 * 函数体控制在 ≤ 20 行，不含任何内联业务规则判定（R9 / 红线 #2）。
 * 涉及“读取 + 更新”的多步骤写操作均用 db.transaction() 显式包裹（R22）。
 */
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, or } from 'drizzle-orm';
import { withAuth, type AuthContext } from '@/lib/auth';
import {
  createUser,
  toggleUserStatus,
  deleteUser,
  applyUserUpdate,
  toDomainUser,
  userToInsertRow,
  userToUpdateRow,
} from '@/domain/user/user';
import {
  CreateUserInputSchema,
  UpdateUserInputSchema,
  UserIdentityInputSchema,
  type CreateUserInput,
} from '@/domain/user/types';
import { EntityNotFoundError, DuplicateEntityError } from '@/domain/shared/errors';
import { generateId } from '@/lib/crypto';
import { hashPassword } from '@/lib/password';
import { clearUserPermissionCache } from '@/lib/permissions';
import type { ApiResponse } from '@auth-sso/contracts';

/**
 * 创建新用户 Action Controller
 *
 * 支持两种调用签名：
 * - 直接传参：createUserAction(input)
 * - React 19 Form Action：createUserAction(null, formData)
 */
export const createUserAction = withAuth(
  { permissions: ['user:create'] },
  async (
    _ctx: AuthContext,
    firstArg: CreateUserInput | null | undefined,
    secondArg?: FormData,
  ): Promise<ApiResponse<{ id: string }>> => {
    // 兼容双签名：FormData 模式时从 FormData 提取原始字段
    const rawInput = secondArg !== undefined ? Object.fromEntries(secondArg) : firstArg;
    const parsed = CreateUserInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message };
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

      const user = createUser(parsed.data, generateId);
      await tx.insert(schema.users).values({
        ...userToInsertRow(user),
        passwordHash,
      });
      return user;
    });

    revalidatePath('/users');
    return { success: true, data: { id: result.publicId }, message: '用户创建成功' };
  },
);

/**
 * 切换用户启用/禁用状态 Action Controller
 */
export const toggleUserStatusAction = withAuth(
  { permissions: ['user:edit'] },
  async (_ctx: AuthContext, userIdStr: string): Promise<ApiResponse<{ status: string }>> => {
    const parsed = UserIdentityInputSchema.safeParse({ id: userIdStr });
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message };
    }

    // 读取 + 更新在事务中原子完成（R22）
    const updated = await db.transaction(async (tx) => {
      const row = await tx.query.users.findFirst({ where: eq(schema.users.id, parsed.data.id) });
      if (!row) throw new EntityNotFoundError('User', parsed.data.id);

      const target = toggleUserStatus(toDomainUser(row));
      await tx.update(schema.users)
        .set({ status: target.status, updatedAt: new Date() })
        .where(eq(schema.users.id, parsed.data.id));
      return target;
    });

    revalidatePath('/users');
    return {
      success: true,
      data: { status: updated.status },
      message: `用户状态已更新为 ${updated.status === 'ACTIVE' ? '正常' : '已禁用'}`,
    };
  },
);

/**
 * 获取特定用户详细信息 (用于详情页，读模型直调)
 */
export const getUserAction = withAuth(
  { permissions: ['user:read'] },
  async (_ctx: AuthContext, userIdStr: string): Promise<ApiResponse<Record<string, unknown>>> => {
    const parsed = UserIdentityInputSchema.safeParse({ id: userIdStr });
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message };
    }

    const userRow = await db.query.users.findFirst({ where: eq(schema.users.id, parsed.data.id) });
    if (!userRow) throw new EntityNotFoundError('User', parsed.data.id);

    // 并行获取角色与部门（独立查询，无依赖关系）
    const [roles, dept] = await Promise.all([
      db.select({
        id: schema.roles.id, publicId: schema.roles.publicId,
        code: schema.roles.code, name: schema.roles.name,
        description: schema.roles.description,
      }).from(schema.roles)
        .innerJoin(schema.userRoles, eq(schema.roles.id, schema.userRoles.roleId))
        .where(eq(schema.userRoles.userId, userRow.id)),
      userRow.deptId
        ? db.query.departments.findFirst({ where: eq(schema.departments.id, userRow.deptId) })
        : null,
    ]);

    return {
      success: true,
      data: {
        ...toDomainUser(userRow),
        createdAt: userRow.createdAt.toISOString(),
        updatedAt: userRow.updatedAt?.toISOString(),
        lastLoginAt: userRow.lastLoginAt?.toISOString(),
        deptName: dept?.name || null,
        roles,
      },
    };
  },
);

/**
 * 更新用户信息 Action Controller
 */
export const updateUserAction = withAuth(
  { permissions: ['user:edit'] },
  async (
    _ctx: AuthContext,
    userIdStr: string,
    input: Record<string, unknown>,
  ): Promise<ApiResponse<{ id: string }>> => {
    const parsed = UpdateUserInputSchema.safeParse({ id: userIdStr, ...input });
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message };
    }

    // 读取 + 更新在事务中原子完成（R22）；领域纯函数负责字段 merge 策略
    await db.transaction(async (tx) => {
      const row = await tx.query.users.findFirst({ where: eq(schema.users.id, parsed.data.id) });
      if (!row) throw new EntityNotFoundError('User', parsed.data.id);

      const updated = applyUserUpdate(toDomainUser(row), {
        name: parsed.data.name,
        email: parsed.data.email,
        status: parsed.data.status,
        deptId: parsed.data.deptId,
        avatarUrl: parsed.data.avatarUrl,
      });
      await tx.update(schema.users).set(userToUpdateRow(updated))
        .where(eq(schema.users.id, parsed.data.id));
    });

    await clearUserPermissionCache(parsed.data.id);
    revalidatePath('/users');
    return { success: true, data: { id: parsed.data.id }, message: '更新成功' };
  },
);

/**
 * 逻辑删除用户 Action Controller
 */
export const deleteUserAction = withAuth(
  { permissions: ['user:delete'] },
  async (_ctx: AuthContext, userIdStr: string): Promise<ApiResponse<{ id: string }>> => {
    const parsed = UserIdentityInputSchema.safeParse({ id: userIdStr });
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message };
    }

    // 读取 + 更新在事务中原子完成（R22）；领域纯函数执行删除规则校验
    await db.transaction(async (tx) => {
      const row = await tx.query.users.findFirst({ where: eq(schema.users.id, parsed.data.id) });
      if (!row) throw new EntityNotFoundError('User', parsed.data.id);

      const deleted = deleteUser(toDomainUser(row));
      await tx.update(schema.users)
        .set({ status: deleted.status, updatedAt: new Date() })
        .where(eq(schema.users.id, parsed.data.id));
    });

    await clearUserPermissionCache(parsed.data.id);
    revalidatePath('/users');
    return { success: true, data: { id: parsed.data.id }, message: '用户已逻辑删除' };
  },
);
