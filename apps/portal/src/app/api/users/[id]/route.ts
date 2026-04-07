/**
 * 单个用户操作 API
 * GET /api/users/[id] - 获取用户详情
 * PUT /api/users/[id] - 更新用户
 * DELETE /api/users/[id] - 删除用户
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { withPermission, checkDataScope, getDataScopeFilter } from '@/lib/auth-middleware';

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
  return withPermission(request, { permissions: ['user:read'] }, async (adminUserId) => {
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

    // 数据范围检查
    if (user.dept_id) {
      const hasScope = await checkDataScope(adminUserId, user.dept_id);
      if (!hasScope) {
        return NextResponse.json(
          { error: 'forbidden', message: '无权查看该用户' },
          { status: 403 }
        );
      }
    } else {
      // 如果目标用户没有部门，检查管理员是否拥有全量权限
      const filter = await getDataScopeFilter(adminUserId);
      if (filter.type !== 'ALL') {
        return NextResponse.json(
          { error: 'forbidden', message: '无权查看无部门用户' },
          { status: 403 }
        );
      }
    }

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
  return withPermission(request, { permissions: ['user:update'] }, async (adminUserId) => {
    const { id } = await params;
    const body = await request.json();
    const { name, email, status, deptId, avatarUrl } = body;

    // 检查用户是否存在
    const users = await sql`
      SELECT id, dept_id FROM users WHERE id = ${id} OR public_id = ${id}
    `;

    if (users.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: '用户不存在' },
        { status: 404 }
      );
    }

    const existingUser = users[0];

    // 数据范围检查：修改用户前，用户必须在当前管理员的数据范围内
    if (existingUser.dept_id) {
      const hasScope = await checkDataScope(adminUserId, existingUser.dept_id);
      if (!hasScope) {
        return NextResponse.json(
          { error: 'forbidden', message: '无权修改该用户' },
          { status: 403 }
        );
      }
    } else {
      const filter = await getDataScopeFilter(adminUserId);
      if (filter.type !== 'ALL') {
        return NextResponse.json(
          { error: 'forbidden', message: '无权修改无部门用户' },
          { status: 403 }
        );
      }
    }

    // 如果尝试将用户移至新部门，检查新部门是否在范围内
    if (deptId && deptId !== existingUser.dept_id) {
      const hasNewScope = await checkDataScope(adminUserId, deptId);
      if (!hasNewScope) {
        return NextResponse.json(
          { error: 'forbidden', message: '无权将用户移至该部门' },
          { status: 403 }
        );
      }
    }

    // 更新用户
    await sql`
      UPDATE users
      SET
        name = COALESCE(${name}, name),
        email = COALESCE(${email}, email),
        status = COALESCE(${status}, status),
        dept_id = ${deptId !== undefined ? (deptId || null) : existingUser.dept_id},
        avatar_url = COALESCE(${avatarUrl}, avatar_url),
        updated_at = NOW()
      WHERE id = ${existingUser.id}
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
  return withPermission(request, { permissions: ['user:delete'] }, async (adminUserId) => {
    const { id } = await params;

    // 检查用户是否存在
    const users = await sql`
      SELECT id, dept_id FROM users WHERE id = ${id} OR public_id = ${id}
    `;

    if (users.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: '用户不存在' },
        { status: 404 }
      );
    }

    const existingUser = users[0];

    // 数据范围检查
    if (existingUser.dept_id) {
      const hasScope = await checkDataScope(adminUserId, existingUser.dept_id);
      if (!hasScope) {
        return NextResponse.json(
          { error: 'forbidden', message: '无权删除该用户' },
          { status: 403 }
        );
      }
    } else {
      const filter = await getDataScopeFilter(adminUserId);
      if (filter.type !== 'ALL') {
        return NextResponse.json(
          { error: 'forbidden', message: '无权删除无部门用户' },
          { status: 403 }
        );
      }
    }

    // 删除用户（级联删除关联数据）
    await sql`DELETE FROM users WHERE id = ${existingUser.id}`;

    return NextResponse.json({ success: true });
  });
}