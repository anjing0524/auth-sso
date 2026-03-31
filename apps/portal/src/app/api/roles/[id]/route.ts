/**
 * 角色详情 API
 * GET /api/roles/[id] - 获取角色详情
 * PUT /api/roles/[id] - 更新角色
 * DELETE /api/roles/[id] - 删除角色
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/roles/[id]
 * 获取角色详情
 * 权限要求: role:read
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['role:read'] }, async () => {
    const { id } = await params;

    const result = await sql`
      SELECT id, public_id, name, code, description, data_scope_type, is_system, status, sort, created_at
      FROM roles WHERE id = ${id}
    `;

    if (result.length === 0) {
      return NextResponse.json({ error: 'not_found', message: '角色不存在' }, { status: 404 });
    }

    const r = result[0];
    return NextResponse.json({
      data: {
        id: r.id,
        publicId: r.public_id,
        name: r.name,
        code: r.code,
        description: r.description,
        dataScopeType: r.data_scope_type,
        isSystem: r.is_system,
        status: r.status,
        sort: r.sort,
        createdAt: r.created_at,
      },
    });
  });
}

/**
 * PUT /api/roles/[id]
 * 更新角色
 * 权限要求: role:update
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['role:update'] }, async () => {
    const { id } = await params;
    const body = await request.json();
    const { name, description, dataScopeType, sort, status } = body;

    const updates: string[] = [];
    if (name !== undefined) updates.push(`name = '${name.replace(/'/g, "''")}'`);
    if (description !== undefined) updates.push(`description = ${description ? `'${description.replace(/'/g, "''")}'` : 'NULL'}`);
    if (dataScopeType !== undefined) updates.push(`data_scope_type = '${dataScopeType}'`);
    if (sort !== undefined) updates.push(`sort = ${sort}`);
    if (status !== undefined) updates.push(`status = '${status}'`);

    if (updates.length === 0) {
      return NextResponse.json({ error: 'no_updates', message: '没有需要更新的字段' }, { status: 400 });
    }

    updates.push('updated_at = NOW()');

    await sql`
      UPDATE roles SET ${sql.unsafe(updates.join(', '))} WHERE id = ${id}
    `;

    return NextResponse.json({ success: true });
  });
}

/**
 * DELETE /api/roles/[id]
 * 删除角色
 * 权限要求: role:delete
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['role:delete'] }, async () => {
    const { id } = await params;

    // 检查是否系统角色
    const role = await sql`SELECT is_system FROM roles WHERE id = ${id}`;
    if (role.length > 0 && role[0].is_system) {
      return NextResponse.json({ error: 'is_system', message: '系统角色无法删除' }, { status: 400 });
    }

    // 删除角色关联
    await sql`DELETE FROM user_roles WHERE role_id = ${id}`;
    await sql`DELETE FROM role_permissions WHERE role_id = ${id}`;
    await sql`DELETE FROM roles WHERE id = ${id}`;

    return NextResponse.json({ success: true, message: '角色已删除' });
  });
}