/**
 * 用户角色绑定 API
 * GET /api/users/[id]/roles — 委托 data.ts 获取用户的角色
 * POST /api/users/[id]/roles — 为用户分配角色
 * DELETE /api/users/[id]/roles — 移除用户的指定角色
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq, or, and } from 'drizzle-orm';
import { byIdOrPublicId } from '@/db/resolve-id';
import { withPermission } from '@/lib/auth';
import crypto from 'crypto';
import { refreshUserPermissionCache } from '@/lib/permissions';
import { COMMON_ERRORS } from '@auth-sso/contracts';
import { getUserRoles } from '@/app/(dashboard)/users/data';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/users/[id]/roles — 委托 data.ts */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: ['user:read'] }, async () => {
    const { id } = await params;
    const roles = await getUserRoles(id);
    return NextResponse.json({ data: roles });
  });
}

/**
 * POST /api/users/[id]/roles
 * 为用户分配角色（采用强一致性数据库事务保障，防范写中途闪断导致旧绑定尽失）
 * 权限要求: user:update
 *
 * @param request NextRequest 对象
 * @param params 动态路由参数
 * @returns 关联操作成功状态响应
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  return withPermission({ permissions: ['user:update'] }, async () => {
    const { id } = await params;
    const body = await request.json();
    const { roleIds } = body;

    if (!Array.isArray(roleIds) || roleIds.length === 0) {
      return NextResponse.json(
        { error: COMMON_ERRORS.VALIDATION_ERROR, message: '角色ID列表不能为空' },
        { status: 400 }
      );
    }

    // 获取用户ID
    const users = await db.select()
      .from(schema.users)
      .where(byIdOrPublicId('users', id));

    if (users.length === 0) {
      return NextResponse.json(
        { error: COMMON_ERRORS.NOT_FOUND, message: '用户不存在' },
        { status: 404 }
      );
    }

    const userId = users[0]!.id;

    // 采用 Drizzle 强一致性事务锁，确保删除旧角色与关联新角色的原子性
    await db.transaction(async (tx) => {
      // 1. 删除现有的角色绑定
      await tx.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));

      // 2. 插入新的角色绑定
      const userRolesData = roleIds.map(roleId => ({
        id: crypto.randomUUID(),
        userId,
        roleId,
        createdAt: new Date(),
      }));

      await tx.insert(schema.userRoles).values(userRolesData);
    });

    // 3. 分配角色后主动清除该用户的权限缓存，保障缓存强一致性
    await refreshUserPermissionCache(userId);

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
      .where(byIdOrPublicId('users', id));

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

    return NextResponse.json({ success: true });
  });
}