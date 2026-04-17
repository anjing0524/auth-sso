/**
 * 部门详情 API
 * GET /api/departments/[id] - 获取部门详情
 * PUT /api/departments/[id] - 更新部门
 * DELETE /api/departments/[id] - 删除部门
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, or } from 'drizzle-orm';
import { withPermission, checkDataScope } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/departments/[id]
 * 获取部门详情
 * 权限要求: department:read
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['department:read'] }, async (userId) => {
    const { id } = await params;

    const result = await db.select()
      .from(schema.departments)
      .where(or(eq(schema.departments.id, id), eq(schema.departments.publicId, id)));

    if (result.length === 0) {
      return NextResponse.json({ error: 'not_found', message: '部门不存在' }, { status: 404 });
    }

    const d = result[0]!;

    // 数据范围检查
    const hasScope = await checkDataScope(userId, d.id);
    if (!hasScope) {
      return NextResponse.json(
        { error: 'forbidden', message: '无权访问该部门' },
        { status: 403 }
      );
    }

    return NextResponse.json({
      data: {
        id: d.id,
        publicId: d.publicId,
        parentId: d.parentId,
        name: d.name,
        code: d.code,
        sort: d.sort,
        status: d.status,
        createdAt: d.createdAt,
      },
    });
  });
}

/**
 * PUT /api/departments/[id]
 * 更新部门
 * 权限要求: department:update
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['department:update'] }, async (userId) => {
    const { id } = await params;
    const body = await request.json();
    const { name, code, parentId, sort, status } = body;

    // 检查部门是否存在
    const existing = await db.select()
      .from(schema.departments)
      .where(or(eq(schema.departments.id, id), eq(schema.departments.publicId, id)));

    if (existing.length === 0) {
      return NextResponse.json({ error: 'not_found', message: '部门不存在' }, { status: 404 });
    }

    const d = existing[0]!;

    // 数据范围检查：修改部门前，目标部门必须在当前用户管辖范围内
    const hasScope = await checkDataScope(userId, d.id);
    if (!hasScope) {
      return NextResponse.json(
        { error: 'forbidden', message: '无权修改该部门' },
        { status: 403 }
      );
    }

    // 如果尝试修改父部门，检查新父部门是否在范围内
    if (parentId !== undefined && parentId !== d.parentId && parentId !== null) {
      const hasNewParentScope = await checkDataScope(userId, parentId);
      if (!hasNewParentScope) {
        return NextResponse.json(
          { error: 'forbidden', message: '无权将部门移至该父部门下' },
          { status: 403 }
        );
      }
    }

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name;
    if (code !== undefined) updateData.code = code;
    if (parentId !== undefined) updateData.parentId = parentId || null;
    if (sort !== undefined) updateData.sort = sort;
    if (status !== undefined) updateData.status = status;

    await db.update(schema.departments).set(updateData).where(eq(schema.departments.id, d.id));

    return NextResponse.json({ success: true });
  });
}

/**
 * DELETE /api/departments/[id]
 * 删除部门
 * 权限要求: department:delete
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['department:delete'] }, async (userId) => {
    const { id } = await params;

    // 检查部门是否存在
    const existing = await db.select()
      .from(schema.departments)
      .where(or(eq(schema.departments.id, id), eq(schema.departments.publicId, id)));

    if (existing.length === 0) {
      return NextResponse.json({ error: 'not_found', message: '部门不存在' }, { status: 404 });
    }

    const d = existing[0]!;

    // 数据范围检查
    const hasScope = await checkDataScope(userId, d.id);
    if (!hasScope) {
      return NextResponse.json(
        { error: 'forbidden', message: '无权删除该部门' },
        { status: 403 }
      );
    }

    // 检查是否有子部门
    const children = await db.select()
      .from(schema.departments)
      .where(eq(schema.departments.parentId, d.id))
      .limit(1);

    if (children.length > 0) {
      return NextResponse.json({ error: 'has_children', message: '该部门下有子部门，无法删除' }, { status: 400 });
    }

    await db.delete(schema.departments).where(eq(schema.departments.id, d.id));

    return NextResponse.json({ success: true, message: '部门已删除' });
  });
}