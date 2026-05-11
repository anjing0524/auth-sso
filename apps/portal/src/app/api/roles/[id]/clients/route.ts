/**
 * 角色客户端绑定 API
 * GET /api/roles/[id]/clients - 获取角色的可访问客户端
 * POST /api/roles/[id]/clients - 为角色分配可访问客户端
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, or } from 'drizzle-orm';
import { withPermission } from '@/lib/auth-middleware';
import crypto from 'crypto';

export const runtime = 'nodejs';

/**
 * GET /api/roles/[id]/clients
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withPermission(request, { permissions: ['role:read'] }, async () => {
    const { id } = await params;

    const clients = await db.select({
      id: schema.clients.id,
      publicId: schema.clients.publicId,
      name: schema.clients.name,
      clientId: schema.clients.clientId,
      assignedAt: schema.roleClients.createdAt,
    })
    .from(schema.clients)
    .innerJoin(schema.roleClients, eq(schema.clients.clientId, schema.roleClients.clientId))
    .innerJoin(schema.roles, eq(schema.roleClients.roleId, schema.roles.id))
    .where(or(eq(schema.roles.id, id), eq(schema.roles.publicId, id)));

    return NextResponse.json({
      data: clients,
    });
  });
}

/**
 * POST /api/roles/[id]/clients
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withPermission(request, { permissions: ['role:update'] }, async () => {
    const { id } = await params;
    const body = await request.json();
    const { clientIds } = body; // 这里接收的是 clients.clientId 列表

    if (!Array.isArray(clientIds)) {
      return NextResponse.json(
        { error: 'invalid_params', message: '客户端ID列表格式错误' },
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

    // 删除现有的绑定
    await db.delete(schema.roleClients).where(eq(schema.roleClients.roleId, roleId));

    // 插入新的绑定
    if (clientIds.length > 0) {
      const roleClientsData = clientIds.map(clientId => ({
        id: crypto.randomUUID(),
        roleId,
        clientId,
        createdAt: new Date(),
      }));
      await db.insert(schema.roleClients).values(roleClientsData);
    }

    return NextResponse.json({ success: true, assignedCount: clientIds.length });
  });
}
