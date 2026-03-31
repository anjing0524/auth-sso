/**
 * 用户角色绑定 API
 * GET /api/users/[id]/roles - 获取用户的角色
 * POST /api/users/[id]/roles - 为用户分配角色
 * DELETE /api/users/[id]/roles - 移除用户的角色
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
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

      const roles = await sql`
        SELECT
          r.id,
          r.public_id,
          r.code,
          r.name,
          r.description,
          r.data_scope_type,
          r.status,
          ur.created_at as assigned_at
        FROM roles r
        JOIN user_roles ur ON r.id = ur.role_id
        JOIN users u ON ur.user_id = u.id
        WHERE u.id = ${id} OR u.public_id = ${id}
        ORDER BY ur.created_at DESC
      `;

      return NextResponse.json({
        data: roles.map((r: any) => ({
          id: r.id,
          publicId: r.public_id,
          code: r.code,
          name: r.name,
          description: r.description,
          dataScopeType: r.data_scope_type,
          status: r.status,
          assignedAt: r.assigned_at,
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
      const users = await sql`
        SELECT id FROM users WHERE id = ${id} OR public_id = ${id}
      `;

      if (users.length === 0) {
        return NextResponse.json(
          { error: 'not_found', message: '用户不存在' },
          { status: 404 }
        );
      }

      const userId = users[0].id;

      // 删除现有的角色绑定
      await sql`DELETE FROM user_roles WHERE user_id = ${userId}`;

      // 插入新的角色绑定
      for (const roleId of roleIds) {
        const urId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substring(2)}`;
        await sql`
          INSERT INTO user_roles (id, user_id, role_id, created_at)
          VALUES (${urId}, ${userId}, ${roleId}, NOW())
        `;
      }

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
      const users = await sql`
        SELECT id FROM users WHERE id = ${id} OR public_id = ${id}
      `;

      if (users.length === 0) {
        return NextResponse.json(
          { error: 'not_found', message: '用户不存在' },
          { status: 404 }
        );
      }

      await sql`
        DELETE FROM user_roles
        WHERE user_id = ${users[0].id} AND role_id = ${roleId}
      `;

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