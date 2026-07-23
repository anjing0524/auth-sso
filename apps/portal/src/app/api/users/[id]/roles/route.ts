/**
 * 用户角色绑定 API
 * GET /api/users/[id]/roles — 委托 data.ts 获取用户的角色
 * POST /api/users/[id]/roles — 为用户分配角色
 * DELETE /api/users/[id]/roles — 移除用户的指定角色
 */
import { type NextRequest } from 'next/server';
import { revalidatePath, updateTag } from 'next/cache';
import { z } from 'zod';
import { db, schema } from '@/infrastructure/db';
import { eq, inArray, and } from 'drizzle-orm';
import { withPermission, canAccessDept, getUserRoleDeptIds, logServerDataRead } from '@/lib/auth';
import { appendSecurityAudit, extractClientIP, extractUserAgent } from '@/lib/audit';
import { refreshUserPermissionCache } from '@/lib/permissions';
import { revokeUserAccessByUserId } from '@/lib/session/revoke';
import { COMMON_ERRORS, USER_ERRORS, ENTITY_ACTIVE } from '@auth-sso/contracts';
import { getUserRoles } from '@/app/(dashboard)/users/data';
import { restSuccess, restError } from '@/lib/response';

interface RouteParams { params: Promise<{ id: string }>; }

const MAX_ASSIGNED_ROLES = 100;

const RoleAssignmentBodySchema = z.object({
  roleIds: z.array(z.string().uuid()).min(1).max(MAX_ASSIGNED_ROLES),
}).superRefine(({ roleIds }, ctx) => {
  if (new Set(roleIds).size !== roleIds.length) {
    ctx.addIssue({ code: 'custom', message: '角色 ID 不可重复', path: ['roleIds'] });
  }
});

const RoleRemovalBodySchema = z.object({
  roleId: z.string().uuid(),
});

/** v3.2: 校验角色全部属于用户部门且为 ACTIVE（R-USER-ROLE），返回 null 表示通过 */
async function validateRoleAssignment(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userDeptId: string | null,
  roleIds: readonly string[],
): Promise<string | null> {
  if (!userDeptId) return '该用户尚未分配部门，请先为用户分配部门后再分配角色';
  const roles = await tx.select({ id: schema.roles.id, deptId: schema.roles.deptId, status: schema.roles.status })
    .from(schema.roles).where(inArray(schema.roles.id, roleIds));
  if (roles.length !== roleIds.length) return '存在无效角色';
  const invalid = roles.filter(r => r.deptId !== userDeptId || r.status !== ENTITY_ACTIVE);
  return invalid.length > 0 ? '部分角色不属于该用户所属部门或已禁用，无法分配' : null;
}

/** GET /api/users/[id]/roles — 委托 data.ts */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: ['user:read'] }, async (_adminUserId) => {
    const { id } = await params;
    const target = await db.query.users.findFirst({
      where: eq(schema.users.id, id),
      columns: { id: true, deptId: true },
    });
    if (!target) {
      return restError(USER_ERRORS.USER_NOT_FOUND, '用户不存在', 404);
    }
    const deptIds = await getUserRoleDeptIds(_adminUserId);
    if (!canAccessDept(deptIds, target.deptId)) {
      return restError(COMMON_ERRORS.FORBIDDEN, '无权查看该用户', 403);
    }
    const roles = await getUserRoles(id);
    await logServerDataRead('user_roles', id);
    return restSuccess(roles);
  });
}

/**
 * POST /api/users/[id]/roles — 为用户分配角色（v3.2: R-USER-ROLE 部门约束）
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: ['user:assign_role'] }, async (adminUserId) => {
    const { id } = await params;
    const parsed = RoleAssignmentBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return restError(COMMON_ERRORS.VALIDATION_ERROR, '角色ID列表格式不合法', 400);
    const { roleIds } = parsed.data;

    const users = await db.select().from(schema.users).where(eq(schema.users.id, id));
    if (users.length === 0) return restError(COMMON_ERRORS.NOT_FOUND, '用户不存在', 404);

    const userId = users[0]!.id;

    const deptIds = await getUserRoleDeptIds(adminUserId);
    if (!canAccessDept(deptIds, users[0]!.deptId)) {
      return restError(COMMON_ERRORS.FORBIDDEN, '无权操作该用户', 403);
    }

    // 事务内重读用户 deptId + 重验角色部门约束，防止 TOCTOU（H-ACL-002）
    const result = await db.transaction(async (tx) => {
      const userRow = await tx.query.users.findFirst({
        where: eq(schema.users.id, id),
        columns: { id: true, deptId: true },
      });
      if (!userRow) return { error: USER_ERRORS.USER_NOT_FOUND, message: '用户不存在', status: 404 } as const;

      if (!canAccessDept(deptIds, userRow.deptId)) {
        return { error: COMMON_ERRORS.FORBIDDEN, message: '无权操作该用户', status: 403 } as const;
      }

      const errMsg = await validateRoleAssignment(tx, userRow.deptId, roleIds);
      if (errMsg) return { error: COMMON_ERRORS.VALIDATION_ERROR, message: errMsg, status: 400 } as const;

      await tx.delete(schema.userRoles).where(eq(schema.userRoles.userId, userRow.id));
      await tx.insert(schema.userRoles).values(roleIds.map(roleId => ({ userId: userRow.id, roleId, createdAt: new Date() })));
      await appendSecurityAudit(tx, {
        userId: adminUserId,
        operation: 'USER_ROLE_ASSIGN',
        method: 'POST',
        url: request.url,
        params: { targetUserId: userRow.id, roleIds },
        ip: extractClientIP(request.headers),
        userAgent: extractUserAgent(request.headers),
        status: 200,
      });
      return { assignedCount: roleIds }; // no as const — avoids type narrowing issues
    });

    if ('error' in result) {
      const { error, message, status } = result as { error: string; message: string; status: number };
      return restError(error, message, status);
    }

    await refreshUserPermissionCache(userId);
    await revokeUserAccessByUserId(userId);
    revalidatePath('/users');
    updateTag('users-list');
    return restSuccess(result);
  });
}

/**
 * DELETE /api/users/[id]/roles
 * 移除用户的指定角色（🔥已修复：加入 roleId 精准比对，绝不误删该用户的其他所有角色）
 * 权限要求: user:update
 *
 * @param request NextRequest 对象
 * @param params 动态路由参数
 * @returns 成功移除状态响应
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  return withPermission({ permissions: ['user:assign_role'] }, async (adminUserId) => {
    const { id } = await params;
    const parsed = RoleRemovalBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return restError(COMMON_ERRORS.VALIDATION_ERROR, '角色ID格式不合法', 400);
    const { roleId } = parsed.data;

    const deptIds = await getUserRoleDeptIds(adminUserId);
    const result = await db.transaction(async (tx) => {
      const userRow = await tx.query.users.findFirst({
        where: eq(schema.users.id, id),
        columns: { id: true, deptId: true },
      });
      if (!userRow) return { error: COMMON_ERRORS.NOT_FOUND, message: '用户不存在', status: 404 } as const;
      if (!canAccessDept(deptIds, userRow.deptId)) {
        return { error: COMMON_ERRORS.FORBIDDEN, message: '无权操作该用户', status: 403 } as const;
      }
      await tx.delete(schema.userRoles).where(and(
        eq(schema.userRoles.userId, userRow.id),
        eq(schema.userRoles.roleId, roleId),
      ));
      await appendSecurityAudit(tx, {
        userId: adminUserId,
        operation: 'USER_ROLE_ASSIGN',
        method: 'DELETE',
        url: request.url,
        params: { targetUserId: userRow.id, roleId },
        ip: extractClientIP(request.headers),
        userAgent: extractUserAgent(request.headers),
        status: 200,
      });
      return { userId: userRow.id } as const;
    });
    if ('error' in result) return restError(result.error, result.message, result.status);
    const userId = result.userId;

    // 移除角色后主动清除该用户的权限缓存，保障缓存强一致性
    await refreshUserPermissionCache(userId);

    // 角色移除属于权限决策变更：强制该用户重登以更新 JWT claims（见 POST 同名注释）
    await revokeUserAccessByUserId(userId);

    // 失效页面与数据缓存
    revalidatePath('/users');
    updateTag('users-list');

    return restSuccess({});
  });
}
