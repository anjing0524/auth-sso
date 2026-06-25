/**
 * 用户角色绑定 API
 * GET /api/users/[id]/roles — 委托 data.ts 获取用户的角色
 * POST /api/users/[id]/roles — 为用户分配角色
 * DELETE /api/users/[id]/roles — 移除用户的指定角色
 */
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, inArray, and } from 'drizzle-orm';
import { withPermission } from '@/lib/auth';
import crypto from 'crypto';
import { refreshUserPermissionCache } from '@/lib/permissions';
import { revokeUserAccessByUserId } from '@/lib/session/revoke';
import { COMMON_ERRORS } from '@auth-sso/contracts';
import { getUserRoles } from '@/app/(dashboard)/users/data';


interface RouteParams { params: Promise<{ id: string }>; }

/** v3.2: 校验角色全部属于用户部门（R-USER-ROLE），返回 null 表示通过 */
async function validateDeptConstraint(userDeptId: string | null, roleIds: string[]): Promise<string | null> {
  if (!userDeptId) return '该用户尚未分配部门，请先为用户分配部门后再分配角色';
  const roles = await db.select({ id: schema.roles.id, deptId: schema.roles.deptId })
    .from(schema.roles).where(inArray(schema.roles.id, roleIds));
  const invalid = roles.filter(r => r.deptId !== userDeptId);
  return invalid.length > 0 ? '部分角色不属于该用户所属部门，无法分配' : null;
}

/** GET /api/users/[id]/roles — 委托 data.ts */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: ['user:read'] }, async () => {
    const { id } = await params;
    const roles = await getUserRoles(id);
    return NextResponse.json({ data: roles });
  });
}

/**
 * POST /api/users/[id]/roles — 为用户分配角色（v3.2: R-USER-ROLE 部门约束）
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: ['user:update'] }, async () => {
    const { id } = await params;
    const body = await request.json();
    const { roleIds } = body;
    if (!Array.isArray(roleIds) || roleIds.length === 0) {
      return NextResponse.json({ error: COMMON_ERRORS.VALIDATION_ERROR, message: '角色ID列表不能为空' }, { status: 400 });
    }

    const users = await db.select().from(schema.users).where(eq(schema.users.id, id));
    if (users.length === 0) return NextResponse.json({ error: COMMON_ERRORS.NOT_FOUND, message: '用户不存在' }, { status: 404 });

    const userId = users[0]!.id;
    const errMsg = await validateDeptConstraint(users[0]!.deptId, roleIds);
    if (errMsg) return NextResponse.json({ error: COMMON_ERRORS.VALIDATION_ERROR, message: errMsg }, { status: 400 });

    await db.transaction(async (tx) => {
      await tx.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
      await tx.insert(schema.userRoles).values(roleIds.map(roleId => ({ id: crypto.randomUUID(), userId, roleId, createdAt: new Date() })));
    });

    await refreshUserPermissionCache(userId);
    await revokeUserAccessByUserId(userId);
    revalidatePath('/users');
    revalidateTag('users-list', 'max');
    return NextResponse.json({ success: true, assignedCount: roleIds.length });
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
  return withPermission({ permissions: ['user:update'] }, async () => {
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
    revalidateTag('users-list', 'max');

    return NextResponse.json({ success: true });
  });
}