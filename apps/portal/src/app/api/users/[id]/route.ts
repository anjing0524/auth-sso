/**
 * 单个用户操作 API
 * GET /api/users/[id] - 获取用户详情
 * PUT /api/users/[id] - 更新用户
 * DELETE /api/users/[id] - 删除用户
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, or } from 'drizzle-orm';
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
    const users = await db.select({
      id: schema.users.id,
      publicId: schema.users.publicId,
      username: schema.users.username,
      email: schema.users.email,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
      status: schema.users.status,
      deptId: schema.users.deptId,
      deptName: schema.departments.name,
      createdAt: schema.users.createdAt,
      updatedAt: schema.users.updatedAt,
      lastLoginAt: schema.users.lastLoginAt,
    })
    .from(schema.users)
    .leftJoin(schema.departments, eq(schema.users.deptId, schema.departments.id))
    .where(or(eq(schema.users.id, id), eq(schema.users.publicId, id)));

    if (users.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: '用户不存在' },
        { status: 404 }
      );
    }

    const user = users[0]!;

    // 数据范围检查
    if (user.deptId) {
      const hasScope = await checkDataScope(adminUserId, user.deptId);
      if (!hasScope) {
        return NextResponse.json(
          { error: 'forbidden', message: '无权查看该用户' },
          { status: 403 }
        );
      }
    } else {
      const filter = await getDataScopeFilter(adminUserId);
      if (filter.type !== 'ALL') {
        return NextResponse.json(
          { error: 'forbidden', message: '无权查看无部门用户' },
          { status: 403 }
        );
      }
    }

    // 查询用户角色
    const roles = await db.select({
      id: schema.roles.id,
      publicId: schema.roles.publicId,
      code: schema.roles.code,
      name: schema.roles.name,
      description: schema.roles.description,
    })
    .from(schema.roles)
    .innerJoin(schema.userRoles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(eq(schema.userRoles.userId, user.id));

    return NextResponse.json({
      data: {
        id: user.id,
        publicId: user.publicId,
        username: user.username,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        status: user.status,
        deptId: user.deptId,
        deptName: user.deptName,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastLoginAt: user.lastLoginAt,
        roles: roles.map(r => ({
          id: r.id,
          publicId: r.publicId,
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
    const users = await db.select()
      .from(schema.users)
      .where(or(eq(schema.users.id, id), eq(schema.users.publicId, id)));

    if (users.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: '用户不存在' },
        { status: 404 }
      );
    }

    const existingUser = users[0]!;

    // 数据范围检查：修改用户前，用户必须在当前管理员的数据范围内
    if (existingUser.deptId) {
      const hasScope = await checkDataScope(adminUserId, existingUser.deptId);
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
    if (deptId && deptId !== existingUser.deptId) {
      const hasNewScope = await checkDataScope(adminUserId, deptId);
      if (!hasNewScope) {
        return NextResponse.json(
          { error: 'forbidden', message: '无权将用户移至该部门' },
          { status: 403 }
        );
      }
    }

    // 更新用户
    await db.update(schema.users)
      .set({
        name: name ?? existingUser.name,
        email: email ?? existingUser.email,
        status: status ?? existingUser.status,
        deptId: deptId !== undefined ? (deptId || null) : existingUser.deptId,
        avatarUrl: avatarUrl ?? existingUser.avatarUrl,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, existingUser.id));

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
    const users = await db.select()
      .from(schema.users)
      .where(or(eq(schema.users.id, id), eq(schema.users.publicId, id)));

    if (users.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: '用户不存在' },
        { status: 404 }
      );
    }

    const existingUser = users[0]!;

    // 数据范围检查
    if (existingUser.deptId) {
      const hasScope = await checkDataScope(adminUserId, existingUser.deptId);
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
    await db.delete(schema.users).where(eq(schema.users.id, existingUser.id));

    return NextResponse.json({ success: true });
  });
}