/**
 * 部门成员列表 API
 * GET /api/departments/[id]/members - 获取指定部门的成员列表
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq, or } from 'drizzle-orm';
import { withPermission } from '@/lib/auth';
import { COMMON_ERRORS } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * 路由动态参数接口定义
 */
interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/departments/[id]/members
 * 获取指定部门的成员列表
 * 权限要求: user:list
 *
 * @param request NextRequest 对象
 * @param params 动态路由参数部门 ID (支持 UUID 或 publicId)
 * @returns 部门下的成员列表响应
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  return withPermission(request, { permissions: ['user:list'] }, async () => {
    try {
      const { id } = await params;

      // 通过 publicId 或 id 查找部门
      const dept = await db.select({ id: schema.departments.id })
        .from(schema.departments)
        .where(or(
          eq(schema.departments.id, id),
          eq(schema.departments.publicId, id),
        ));

      if (dept.length === 0) {
        return NextResponse.json(
          { error: COMMON_ERRORS.NOT_FOUND, message: '部门不存在' },
          { status: 404 }
        );
      }

      const deptId = dept[0]!.id;

      const members = await db.select({
        id: schema.users.id,
        publicId: schema.users.publicId,
        name: schema.users.name,
        username: schema.users.username,
        email: schema.users.email,
        avatarUrl: schema.users.avatarUrl,
        status: schema.users.status,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(eq(schema.users.deptId, deptId));

      return NextResponse.json({ data: members });
    } catch (error) {
      console.error('[DeptMembers GET] Failed to retrieve members for department:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '获取部门成员列表失败' },
        { status: 500 }
      );
    }
  });
}
