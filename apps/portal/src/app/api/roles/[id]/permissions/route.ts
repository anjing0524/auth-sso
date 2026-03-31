/**
 * 角色权限绑定 API
 * GET /api/roles/[id]/permissions - 获取角色的权限
 * POST /api/roles/[id]/permissions - 为角色分配权限
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
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

    const permissions = await sql`
      SELECT
        p.id,
        p.public_id,
        p.code,
        p.name,
        p.type,
        p.resource,
        p.action,
        rp.created_at as assigned_at
      FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      JOIN roles r ON rp.role_id = r.id
      WHERE r.id = ${id} OR r.public_id = ${id}
      ORDER BY p.type, p.sort
    `;

    return NextResponse.json({
      data: permissions.map((p: any) => ({
        id: p.id,
        publicId: p.public_id,
        code: p.code,
        name: p.name,
        type: p.type,
        resource: p.resource,
        action: p.action,
        assignedAt: p.assigned_at,
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
    const roles = await sql`
      SELECT id FROM roles WHERE id = ${id} OR public_id = ${id}
    `;

    if (roles.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: '角色不存在' },
        { status: 404 }
      );
    }

    const roleId = roles[0].id;

    // 删除现有的权限绑定
    await sql`DELETE FROM role_permissions WHERE role_id = ${roleId}`;

    // 插入新的权限绑定
    for (const permissionId of permissionIds) {
      const rpId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      await sql`
        INSERT INTO role_permissions (id, role_id, permission_id, created_at)
        VALUES (${rpId}, ${roleId}, ${permissionId}, NOW())
      `;
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