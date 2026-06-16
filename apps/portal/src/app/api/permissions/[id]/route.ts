/**
 * 权限详情与修改 API 路由端点
 *
 * GET /api/permissions/[id] - 获取特定权限详情 (支持 UUID 及 publicId)
 * PATCH /api/permissions/[id] - 修改权限信息 (严格过滤可修改载荷，增加 try-catch 安全网)
 * DELETE /api/permissions/[id] - 删除权限项 (增加 try-catch 安全网)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq, or } from 'drizzle-orm';
import { withPermission } from '@/lib/auth';
import { COMMON_ERRORS } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * 动态路由参数定义
 */
interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * 允许修改的权限更新数据载荷定义
 */
interface PermissionUpdatePayload {
  name?: string;
  code?: string;
  type?: 'MENU' | 'API' | 'DATA';
  resource?: string | null;
  action?: string | null;
  parentId?: string | null;
  sort?: number;
  status?: 'ACTIVE' | 'DISABLED';
}

/**
 * GET /api/permissions/[id]
 * 获取特定权限详情
 *
 * @param request NextRequest 对象
 * @param routeParams 动态路由参数
 * @returns JSON 响应，包含权限详情数据
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  return withPermission(request, { permissions: ['permission:list'] }, async () => {
    try {
      const { id } = await params;
      const items = await db.select().from(schema.permissions)
        .where(or(eq(schema.permissions.id, id), eq(schema.permissions.publicId, id)))
        .limit(1);

      if (items.length === 0) {
        return NextResponse.json(
          { error: COMMON_ERRORS.NOT_FOUND, message: '权限不存在' },
          { status: 404 }
        );
      }

      return NextResponse.json({ data: items[0] });
    } catch (error) {
      console.error('[Permission Detail GET] Failed to fetch permission details:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '获取权限详情失败' },
        { status: 500 }
      );
    }
  });
}

/**
 * PATCH /api/permissions/[id]
 * 更新权限信息
 *
 * @param request NextRequest 对象
 * @param routeParams 动态路由参数
 * @returns JSON 响应，包含成功状态
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  return withPermission(request, { permissions: ['permission:update'] }, async () => {
    try {
      const { id } = await params;
      const body = await request.json();

      // 强类型安全防护：防范不受信任的字段（如 id, publicId 等）在写库时产生污染
      const updatePayload: PermissionUpdatePayload = {};
      if (body.name !== undefined) updatePayload.name = body.name;
      if (body.code !== undefined) updatePayload.code = body.code;
      if (body.type !== undefined) updatePayload.type = body.type;
      if (body.resource !== undefined) updatePayload.resource = body.resource;
      if (body.action !== undefined) updatePayload.action = body.action;
      if (body.parentId !== undefined) updatePayload.parentId = body.parentId;
      if (body.sort !== undefined) updatePayload.sort = body.sort;
      if (body.status !== undefined) updatePayload.status = body.status;

      const result = await db.update(schema.permissions)
        .set({ ...updatePayload, updatedAt: new Date() })
        .where(or(eq(schema.permissions.id, id), eq(schema.permissions.publicId, id)));

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('[Permission Detail PATCH] Failed to update permission:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '更新权限失败' },
        { status: 500 }
      );
    }
  });
}

/**
 * DELETE /api/permissions/[id]
 * 删除权限项
 *
 * @param request NextRequest 对象
 * @param routeParams 动态路由参数
 * @returns JSON 响应，包含成功状态
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  return withPermission(request, { permissions: ['permission:delete'] }, async () => {
    try {
      const { id } = await params;
      
      await db.delete(schema.permissions)
        .where(or(eq(schema.permissions.id, id), eq(schema.permissions.publicId, id)));

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('[Permission Detail DELETE] Failed to delete permission:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '删除权限失败' },
        { status: 500 }
      );
    }
  });
}

