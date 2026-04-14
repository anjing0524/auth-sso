/**
 * 角色详情 API
 * GET /api/roles/[id] - 获取角色详情
 * PUT /api/roles/[id] - 更新角色
 * DELETE /api/roles/[id] - 删除角色
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
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

    const result = await db.select()
      .from(schema.roles)
      .where(eq(schema.roles.id, id));

    if (result.length === 0) {
      return NextResponse.json({ error: 'not_found', message: '角色不存在' }, { status: 404 });
    }

    const r = result[0]!;
    return NextResponse.json({
      data: {
        id: r.id,
        publicId: r.publicId,
        name: r.name,
        code: r.code,
        description: r.description,
        dataScopeType: r.dataScopeType,
        isSystem: r.isSystem,
        status: r.status,
        sort: r.sort,
        createdAt: r.createdAt,
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

    // 获取现有角色
    const existing = await db.select().from(schema.roles).where(eq(schema.roles.id, id));
    if (existing.length === 0) {
      return NextResponse.json({ error: 'not_found', message: '角色不存在' }, { status: 404 });
    }

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (dataScopeType !== undefined) updateData.dataScopeType = dataScopeType;
    if (sort !== undefined) updateData.sort = sort;
    if (status !== undefined) updateData.status = status;

    await db.update(schema.roles).set(updateData).where(eq(schema.roles.id, id));

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
    const role = await db.select().from(schema.roles).where(eq(schema.roles.id, id));
    if (role.length > 0 && role[0]!.isSystem) {
      return NextResponse.json({ error: 'is_system', message: '系统角色无法删除' }, { status: 400 });
    }

    // 删除角色关联
    await db.delete(schema.userRoles).where(eq(schema.userRoles.roleId, id));
    await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, id));
    await db.delete(schema.roles).where(eq(schema.roles.id, id));

    return NextResponse.json({ success: true, message: '角色已删除' });
  });
}