/**
 * 单个用户操作 API 路由处理器（仅保留 REST 读模型）
 * @module apps/portal/api/users/[id]
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, or } from 'drizzle-orm';
import { withPermission, checkDataScope, getDataScopeFilter } from '@/lib/auth-middleware';
import { COMMON_ERRORS, USER_ERRORS } from '@auth-sso/contracts';

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/users/[id] — 获取用户详情及角色列表
 * 权限要求: user:read
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['user:read'] }, async (adminUserId) => {
    const { id } = await params;

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
        { error: USER_ERRORS.USER_NOT_FOUND, message: '用户不存在' },
        { status: 404 },
      );
    }

    const user = users[0]!;

    // 数据范围检查：管理员必须有权限查看该用户所属部门
    if (user.deptId) {
      const hasScope = await checkDataScope(adminUserId, user.deptId);
      if (!hasScope) {
        return NextResponse.json(
          { error: COMMON_ERRORS.FORBIDDEN, message: '无权查看该用户' },
          { status: 403 },
        );
      }
    } else {
      const filter = await getDataScopeFilter(adminUserId);
      if (filter.type !== 'ALL') {
        return NextResponse.json(
          { error: COMMON_ERRORS.FORBIDDEN, message: '无权查看无部门用户' },
          { status: 403 },
        );
      }
    }

    // 获取用户角色
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
        ...user,
        roles: roles.map((r) => ({ ...r })),
      },
    });
  });
}
