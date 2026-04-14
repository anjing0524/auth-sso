/**
 * 角色权限绑定 API
 * GET /api/roles/[id]/permissions - 获取角色的权限
 * POST /api/roles/[id]/permissions - 为角色分配权限
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, or } from 'drizzle-orm';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

/**
 * GET /api/roles/[id]/permissions
 * 获取角色的权限列表
 * 权限要求: role:read
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withPermission(request, { permissions: ['role:read'] }, async () => {
    const { id } = await params;

    const permissions = await db.select({
      id: schema.permissions.id,
      publicId: schema.permissions.publicId,
      code: schema.permissions.code,
      name: schema.permissions.name,
      type: schema.permissions.type,
      resource: schema.permissions.resource,
      action: schema.permissions.action,
      assignedAt: schema.rolePermissions.createdAt,
    })
    .from(schema.permissions)
    .innerJoin(schema.rolePermissions, eq(schema.permissions.id, schema.rolePermissions.permissionId))
    .innerJoin(schema.roles, eq(schema.rolePermissions.roleId, schema.roles.id))
    .where(or(eq(schema.roles.id, id), eq(schema.roles.publicId, id)));

    return NextResponse.json({
      data: permissions.map(p => ({
        id: p.id,
        publicId: p.publicId,
        code: p.code,
        name: p.name,
        type: p.type,
        resource: p.resource,
        action: p.action,
        assignedAt: p.assignedAt,
      })),
    });
  });
}

/**
 * POST /api/roles/[id]/permissions
 * 为角色分配权限
 * 权限要求: role:update
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withPermission(request, { permissions: ['role:update'] }, async () => {
    const { id } = await params;
    const body = await request.json();
    const { permissionIds } = body;

    if (!Array.isArray(permissionIds)) {
      return NextResponse.json(
        { error: 'invalid_params', message: '权限ID列表格式错误' },
        { status: 400 }
      );
    }

    // 获取角色ID
    const roles = await db.select()
      .from(schema.roles)
      .where(or(eq(schema.roles.id, id), eq(schema.roles.publicId, id)));

    if (roles.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: '角色不存在' },
        { status: 404 }
      );
    }

    const roleId = roles[0]!.id;

    // 删除现有的权限绑定
    await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));

    // 插入新的权限绑定
    if (permissionIds.length > 0) {
      const rolePermissionsData = permissionIds.map(permissionId => ({
        id: crypto.randomUUID(),
        roleId,
        permissionId,
        createdAt: new Date(),
      }));
      await db.insert(schema.rolePermissions).values(rolePermissionsData);
    }

    return NextResponse.json({ success: true, assignedCount: permissionIds.length });
  });
}

/**
 * PUT /api/roles/[id]/permissions
 * 更新角色权限（同 POST）
 * 权限要求: role:update
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return POST(request, { params });
}