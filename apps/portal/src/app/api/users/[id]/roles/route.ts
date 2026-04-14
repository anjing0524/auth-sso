/**
 * 用户角色绑定 API
 * GET /api/users/[id]/roles - 获取用户的角色
 * POST /api/users/[id]/roles - 为用户分配角色
 * DELETE /api/users/[id]/roles - 移除用户的角色
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, or, desc } from 'drizzle-orm';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

/**
 * GET /api/users/[id]/roles
 * 获取用户的角色列表
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withPermission(request, { permissions: ['user:read'] }, async () => {
    try {
      const { id } = await params;

      const roles = await db.select({
        id: schema.roles.id,
        publicId: schema.roles.publicId,
        code: schema.roles.code,
        name: schema.roles.name,
        description: schema.roles.description,
        dataScopeType: schema.roles.dataScopeType,
        status: schema.roles.status,
        assignedAt: schema.userRoles.createdAt,
      })
      .from(schema.roles)
      .innerJoin(schema.userRoles, eq(schema.roles.id, schema.userRoles.roleId))
      .innerJoin(schema.users, eq(schema.userRoles.userId, schema.users.id))
      .where(or(eq(schema.users.id, id), eq(schema.users.publicId, id)))
      .orderBy(desc(schema.userRoles.createdAt));

      return NextResponse.json({
        data: roles.map(r => ({
          id: r.id,
          publicId: r.publicId,
          code: r.code,
          name: r.name,
          description: r.description,
          dataScopeType: r.dataScopeType,
          status: r.status,
          assignedAt: r.assignedAt,
        })),
      });
    } catch (error) {
      console.error('[UserRoles] GET Error:', error);
      return NextResponse.json(
        { error: 'internal_error', message: '获取用户角色失败' },
        { status: 500 }
      );
    }
  });
}

/**
 * POST /api/users/[id]/roles
 * 为用户分配角色
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withPermission(request, { permissions: ['user:update'] }, async () => {
    try {
      const { id } = await params;
      const body = await request.json();
      const { roleIds } = body;

      if (!Array.isArray(roleIds) || roleIds.length === 0) {
        return NextResponse.json(
          { error: 'invalid_params', message: '角色ID列表不能为空' },
          { status: 400 }
        );
      }

      // 获取用户ID
      const users = await db.select()
        .from(schema.users)
        .where(or(eq(schema.users.id, id), eq(schema.users.publicId, id)));

      if (users.length === 0) {
        return NextResponse.json(
          { error: 'not_found', message: '用户不存在' },
          { status: 404 }
        );
      }

      const userId = users[0]!.id;

      // 删除现有的角色绑定
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));

      // 插入新的角色绑定
      const userRolesData = roleIds.map(roleId => ({
        id: crypto.randomUUID(),
        userId,
        roleId,
        createdAt: new Date(),
      }));

      await db.insert(schema.userRoles).values(userRolesData);

      return NextResponse.json({ success: true, assignedCount: roleIds.length });
    } catch (error) {
      console.error('[UserRoles] POST Error:', error);
      return NextResponse.json(
        { error: 'internal_error', message: '分配角色失败' },
        { status: 500 }
      );
    }
  });
}

/**
 * DELETE /api/users/[id]/roles
 * 移除用户的指定角色
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withPermission(request, { permissions: ['user:update'] }, async () => {
    try {
      const { id } = await params;
      const body = await request.json();
      const { roleId } = body;

      if (!roleId) {
        return NextResponse.json(
          { error: 'invalid_params', message: '角色ID不能为空' },
          { status: 400 }
        );
      }

      // 获取用户ID
      const users = await db.select()
        .from(schema.users)
        .where(or(eq(schema.users.id, id), eq(schema.users.publicId, id)));

      if (users.length === 0) {
        return NextResponse.json(
          { error: 'not_found', message: '用户不存在' },
          { status: 404 }
        );
      }

      await db.delete(schema.userRoles)
        .where(eq(schema.userRoles.userId, users[0]!.id));

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('[UserRoles] DELETE Error:', error);
      return NextResponse.json(
        { error: 'internal_error', message: '移除角色失败' },
        { status: 500 }
      );
    }
  });
}