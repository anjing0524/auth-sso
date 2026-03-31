/**
 * 单个用户操作 API
 * GET /api/users/[id] - 获取用户详情
 * PUT /api/users/[id] - 更新用户
 * DELETE /api/users/[id] - 删除用户
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/users/[id]
 * 获取用户详情（含角色）
 * 权限要求: user:read
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['user:read'] }, async () => {
    const { id } = await params;

    // 查询用户
    const users = await sql`
      SELECT
        u.id,
        u.public_id,
        u.username,
        u.email,
        u.name,
        u.avatar_url,
        u.status,
        u.dept_id,
        d.name as dept_name,
        u.created_at,
        u.updated_at,
        u.last_login_at
      FROM users u
      LEFT JOIN departments d ON u.dept_id = d.id
      WHERE u.id = ${id} OR u.public_id = ${id}
    `;

    if (users.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: '用户不存在' },
        { status: 404 }
      );
    }

    const user = users[0];

    // 查询用户角色
    const roles = await sql`
      SELECT r.id, r.public_id, r.code, r.name, r.description
      FROM roles r
      JOIN user_roles ur ON r.id = ur.role_id
      WHERE ur.user_id = ${user.id}
    `;

    return NextResponse.json({
      data: {
        id: user.id,
        publicId: user.public_id,
        username: user.username,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatar_url,
        status: user.status,
        deptId: user.dept_id,
        deptName: user.dept_name,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        lastLoginAt: user.last_login_at,
        roles: roles.map(r => ({
          id: r.id,
          publicId: r.public_id,
          code: r.code,
          name: r.name,
          description: r.description,
        })),
      },
    });
  });
}

/**
 * PUT /api/users/[id]
 * 更新用户
 * 权限要求: user:update
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['user:update'] }, async () => {
    const { id } = await params;
    const body = await request.json();
    const { name, email, status, deptId, avatarUrl } = body;

    // 检查用户是否存在
    const existing = await sql`
      SELECT id FROM users WHERE id = ${id} OR public_id = ${id}
    `;

    if (existing.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: '用户不存在' },
        { status: 404 }
      );
    }

    // 更新用户
    await sql`
      UPDATE users
      SET
        name = COALESCE(${name}, name),
        email = COALESCE(${email}, email),
        status = COALESCE(${status}, status),
        dept_id = ${deptId || null},
        avatar_url = ${avatarUrl || null},
        updated_at = NOW()
      WHERE id = ${existing[0].id}
    `;

    return NextResponse.json({ success: true });
  });
}

/**
 * DELETE /api/users/[id]
 * 删除用户
 * 权限要求: user:delete
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['user:delete'] }, async () => {
    const { id } = await params;

    // 检查用户是否存在
    const existing = await sql`
      SELECT id FROM users WHERE id = ${id} OR public_id = ${id}
    `;

    if (existing.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: '用户不存在' },
        { status: 404 }
      );
    }

    // 删除用户（级联删除关联数据）
    await sql`DELETE FROM users WHERE id = ${existing[0].id}`;

    return NextResponse.json({ success: true });
  });
}