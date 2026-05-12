/**
 * 部门成员列表 API
 * GET /api/departments/[id]/members - 获取指定部门的成员列表
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, or } from 'drizzle-orm';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withPermission(request, { permissions: ['user:list'] }, async () => {
    const { id } = await params;

    // 通过 publicId 或 id 查找部门
    const dept = await db.select({ id: schema.departments.id })
      .from(schema.departments)
      .where(or(
        eq(schema.departments.id, id),
        eq(schema.departments.publicId, id),
      ));

    if (dept.length === 0) {
      return NextResponse.json({ error: 'not_found', message: '部门不存在' }, { status: 404 });
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
  });
}
