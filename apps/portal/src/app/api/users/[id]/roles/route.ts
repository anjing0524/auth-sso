/**
 * 用户角色绑定 API
 * GET /api/users/[id]/roles — 委托 data.ts 获取用户的角色
 * POST /api/users/[id]/roles — 为用户分配角色
 * DELETE /api/users/[id]/roles — 移除用户的指定角色
 */
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath, updateTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, inArray, and } from 'drizzle-orm';
import { withPermission, canAccessDept } from '@/lib/auth';
import crypto from 'crypto';
import { refreshUserPermissionCache } from '@/lib/permissions';
import { revokeUserAccessByUserId } from '@/lib/session/revoke';
import { COMMON_ERRORS, USER_ERRORS, ENTITY_ACTIVE } from '@auth-sso/contracts';
import { getUserRoles } from '@/app/(dashboard)/users/data';

interface RouteParams { params: Promise<{ id: string }>; }

/** v3.2: 校验角色全部属于用户部门且为 ACTIVE（R-USER-ROLE），返回 null 表示通过 */
async function validateDeptConstraint(userDeptId: string | null, roleIds: string[]): Promise<string | null> {
  if (!userDeptId) return '该用户尚未分配部门，请先为用户分配部门后再分配角色';
  const roles = await db.select({ id: schema.roles.id, deptId: schema.roles.deptId, status: schema.roles.status })
    .from(schema.roles).where(inArray(schema.roles.id, roleIds));
  const invalid = roles.filter(r => r.deptId !== userDeptId || r.status !== ENTITY_ACTIVE);
  return invalid.length > 0 ? '部分角色不属于该用户所属部门或已禁用，无法分配' : null;
}

/** GET /api/users/[id]/roles — 委托 data.ts */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: ['user:read'] }, async (_adminUserId, claims) => {
    const { id } = await params;
    const target = await db.query.users.findFirst({
      where: eq(schema.users.id, id),
      columns: { id: true, deptId: true },
    });
    if (!target) {
      return NextResponse.json({ error: USER_ERRORS.USER_NOT_FOUND, message: '用户不存在' }, { status: 404 });
    }
    if (!canAccessDept(claims.deptIds, target.deptId)) {
      return NextResponse.json({ error: COMMON_ERRORS.FORBIDDEN, message: '无权查看该用户' }, { status: 403 });
    }
    const roles = await getUserRoles(id);
    return NextResponse.json({ data: roles });
  });
}

/**
 * POST /api/users/[id]/roles — 为用户分配角色（v3.2: R-USER-ROLE 部门约束）
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: ['user:update'] }, async (_adminUserId, claims) => {
    const { id } = await params;
    const body = await request.json();
    const { roleIds } = body;
    if (!Array.isArray(roleIds) || roleIds.length === 0) {
      return NextResponse.json({ error: COMMON_ERRORS.VALIDATION_ERROR, message: '角色ID列表不能为空' }, { status: 400 });
    }

    const users = await db.select().from(schema.users).where(eq(schema.users.id, id));
    if (users.length === 0) return NextResponse.json({ error: COMMON_ERRORS.NOT_FOUND, message: '用户不存在' }, { status: 404 });

    const userId = users[0]!.id;

    // 数据范围守卫：管理员只能操作其部门范围内用户的角色绑定（H-ACL-002）
    // deptIds 来自 JWT claims，无需额外 DB 查询
    if (!canAccessDept(claims.deptIds, users[0]!.deptId)) {
      return NextResponse.json({ error: COMMON_ERRORS.FORBIDDEN, message: '无权操作该用户' }, { status: 403 });
    }

    // 事务内重读用户 deptId + 重验角色部门约束，防止 TOCTOU（H-ACL-002）
    const result = await db.transaction(async (tx) => {
      const userRow = await tx.query.users.findFirst({
        where: eq(schema.users.id, id),
        columns: { id: true, deptId: true },
      });
      if (!userRow) return { error: USER_ERRORS.USER_NOT_FOUND, status: 404 } as const;

      // 事务内二次数据范围守卫：防止用户部门在极短时间差内被篡改至管理员管辖范围之外（TOCTOU 并发越权）
      if (!canAccessDept(claims.deptIds, userRow.deptId)) {
        return { error: COMMON_ERRORS.FORBIDDEN, message: '无权操作该用户', status: 403 } as const;
      }

      const errMsg = await validateDeptConstraint(userRow.deptId, roleIds);
      if (errMsg) return { error: COMMON_ERRORS.VALIDATION_ERROR, message: errMsg, status: 400 } as const;

      await tx.delete(schema.userRoles).where(eq(schema.userRoles.userId, userRow.id));
      await tx.insert(schema.userRoles).values(roleIds.map(roleId => ({ id: crypto.randomUUID(), userId: userRow.id, roleId, createdAt: new Date() })));
      return { success: true, assignedCount: roleIds } as const;
    });

    if ('error' in result) {
      return NextResponse.json(
        { error: result.error, message: 'message' in result ? result.message : undefined },
        { status: result.status },
      );
    }

    await refreshUserPermissionCache(userId);
    await revokeUserAccessByUserId(userId);
    revalidatePath('/users');
    updateTag('users-list');
    return NextResponse.json(result);
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
  return withPermission({ permissions: ['user:update'] }, async (_adminUserId, claims) => {
    const { id } = await params;
    const body = await request.json();
    const { roleId } = body;

    if (!roleId) {
      return NextResponse.json(
        { error: COMMON_ERRORS.VALIDATION_ERROR, message: '角色ID不能为空' },
        { status: 400 }
      );
    }

    // 获取用户ID
    const users = await db.select()
      .from(schema.users)
      .where(eq(schema.users.id, id));

    if (users.length === 0) {
      return NextResponse.json(
        { error: COMMON_ERRORS.NOT_FOUND, message: '用户不存在' },
        { status: 404 }
      );
    }

    const userId = users[0]!.id;

    // 数据范围守卫：管理员只能操作其部门范围内用户的角色绑定（H-ACL-002）
    // deptIds 来自 JWT claims，无需额外 DB 查询
    if (!canAccessDept(claims.deptIds, users[0]!.deptId)) {
      return NextResponse.json(
        { error: COMMON_ERRORS.FORBIDDEN, message: '无权操作该用户' },
        { status: 403 }
      );
    }

    // 精准删除：加入 roleId 的 AND 条件比对，绝不误清空该用户关联的所有其他角色绑定
    await db.delete(schema.userRoles)
      .where(and(
        eq(schema.userRoles.userId, userId),
        eq(schema.userRoles.roleId, roleId)
      ));

    // 移除角色后主动清除该用户的权限缓存，保障缓存强一致性
    await refreshUserPermissionCache(userId);

    // 角色移除属于权限决策变更：强制该用户重登以更新 JWT claims（见 POST 同名注释）
    await revokeUserAccessByUserId(userId);

    // 失效页面与数据缓存
    revalidatePath('/users');
    updateTag('users-list');

    return NextResponse.json({ success: true });
  });
}