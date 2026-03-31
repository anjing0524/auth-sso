/**
 * 部门详情 API
 * GET /api/departments/[id] - 获取部门详情
 * PUT /api/departments/[id] - 更新部门
 * DELETE /api/departments/[id] - 删除部门
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { withPermission } from '@/lib/auth-middleware';

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
  return withPermission(request, { permissions: ['department:read'] }, async () => {
    const { id } = await params;

    const result = await sql`
      SELECT id, public_id, parent_id, name, code, sort, status, created_at
      FROM departments WHERE id = ${id}
    `;

    if (result.length === 0) {
      return NextResponse.json({ error: 'not_found', message: '部门不存在' }, { status: 404 });
    }

    const d = result[0];
    return NextResponse.json({
      data: {
        id: d.id,
        publicId: d.public_id,
        parentId: d.parent_id,
        name: d.name,
        code: d.code,
        sort: d.sort,
        status: d.status,
        createdAt: d.created_at,
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
  return withPermission(request, { permissions: ['department:update'] }, async () => {
    const { id } = await params;
    const body = await request.json();
    const { name, code, parentId, sort, status } = body;

    const updates: string[] = [];
    if (name !== undefined) updates.push(`name = '${name.replace(/'/g, "''")}'`);
    if (code !== undefined) updates.push(`code = ${code ? `'${code.replace(/'/g, "''")}'` : 'NULL'}`);
    if (parentId !== undefined) updates.push(`parent_id = ${parentId ? `'${parentId}'` : 'NULL'}`);
    if (sort !== undefined) updates.push(`sort = ${sort}`);
    if (status !== undefined) updates.push(`status = '${status}'`);

    if (updates.length === 0) {
      return NextResponse.json({ error: 'no_updates', message: '没有需要更新的字段' }, { status: 400 });
    }

    updates.push('updated_at = NOW()');

    await sql`
      UPDATE departments SET ${sql.unsafe(updates.join(', '))} WHERE id = ${id}
    `;

    return NextResponse.json({ success: true });
  });
}

/**
 * DELETE /api/departments/[id]
 * 删除部门
 * 权限要求: department:delete
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['department:delete'] }, async () => {
    const { id } = await params;

    // 检查是否有子部门
    const children = await sql`
      SELECT id FROM departments WHERE parent_id = ${id} LIMIT 1
    `;

    if (children.length > 0) {
      return NextResponse.json({ error: 'has_children', message: '该部门下有子部门，无法删除' }, { status: 400 });
    }

    await sql`DELETE FROM departments WHERE id = ${id}`;

    return NextResponse.json({ success: true, message: '部门已删除' });
  });
}