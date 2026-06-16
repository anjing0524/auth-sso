/**
 * 角色客户端绑定 API
 * GET /api/roles/[id]/clients - 获取角色的可访问客户端
 * POST /api/roles/[id]/clients - 为角色分配可访问客户端
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq, or } from 'drizzle-orm';
import { withPermission } from '@/lib/auth';
import crypto from 'crypto';
import { COMMON_ERRORS } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * 路由动态参数接口定义
 */
interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/roles/[id]/clients
 * 获取角色的可访问客户端列表
 * 权限要求: role:read
 *
 * @param request NextRequest 对象
 * @param params 动态路由参数
 * @returns 角色的可访问客户端项列表响应
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  return withPermission(request, { permissions: ['role:read'] }, async () => {
    try {
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
    } catch (error) {
      console.error('[RoleClients GET] Failed to retrieve clients for role:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '获取角色客户端失败' },
        { status: 500 }
      );
    }
  });
}

/**
 * POST /api/roles/[id]/clients
 * 为角色分配可访问客户端（通过强一致性数据库事务保障，防范部分写失败污染原有分配）
 * 权限要求: role:update
 *
 * @param request NextRequest 对象
 * @param params 动态路由参数
 * @returns 关联操作成功状态响应
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  return withPermission(request, { permissions: ['role:update'] }, async () => {
    try {
      const { id } = await params;
      const body = await request.json();
      const { clientIds } = body; // 这里接收的是 clients.clientId 列表

      if (!Array.isArray(clientIds)) {
        return NextResponse.json(
          { error: COMMON_ERRORS.VALIDATION_ERROR, message: '客户端ID列表格式错误' },
          { status: 400 }
        );
      }

      // 验证角色是否存在
      const roles = await db.select()
        .from(schema.roles)
        .where(or(eq(schema.roles.id, id), eq(schema.roles.publicId, id)));

      if (roles.length === 0) {
        return NextResponse.json(
          { error: COMMON_ERRORS.NOT_FOUND, message: '角色不存在' },
          { status: 404 }
        );
      }

      const roleId = roles[0]!.id;

      // 采用 Drizzle 事务保障数据库关系操作的 ACID 原子性，如果插入关系崩塌自动回滚
      await db.transaction(async (tx) => {
        // 1. 删除现有的绑定
        await tx.delete(schema.roleClients).where(eq(schema.roleClients.roleId, roleId));

        // 2. 插入新的绑定（如果列表不为空）
        if (clientIds.length > 0) {
          const roleClientsData = clientIds.map(clientId => ({
            id: crypto.randomUUID(),
            roleId,
            clientId,
            createdAt: new Date(),
          }));
          await tx.insert(schema.roleClients).values(roleClientsData);
        }
      });

      return NextResponse.json({ success: true, assignedCount: clientIds.length });
    } catch (error) {
      console.error('[RoleClients POST] Failed to allocate clients to role:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '分配角色客户端失败' },
        { status: 500 }
      );
    }
  });
}
