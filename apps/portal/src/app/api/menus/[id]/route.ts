/**
 * 菜单详情与操作 API 路由处理器
 * GET /api/menus/[id] - 获取菜单详情
 * PATCH /api/menus/[id] - 修改菜单
 * DELETE /api/menus/[id] - 删除菜单
 * 
 * @module apps/portal/api/menus/[id]
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, or } from 'drizzle-orm';
import { withPermission } from '@/lib/auth-middleware';
import { COMMON_ERRORS, EntityStatus } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * 路由参数定义
 */
interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * 菜单更新数据接口定义
 */
interface MenuUpdatePayload {
  name?: string;
  path?: string | null;
  permissionCode?: string | null;
  icon?: string | null;
  sort?: number;
  visible?: boolean;
  status?: EntityStatus;
  menuType?: 'DIRECTORY' | 'MENU' | 'BUTTON';
  parentId?: string | null;
  updatedAt: Date;
}

/**
 * GET /api/menus/[id]
 * 获取特定菜单的详细信息
 * 权限要求: menu:list
 * 
 * @param request Next.js 请求对象
 * @param params 路由参数 (Promise<{ id: string }>)
 * @returns 菜单详情 JSON 响应
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  return withPermission(request, { permissions: ['menu:list'] }, async () => {
    try {
      const { id } = await params;
      const items = await db.select()
        .from(schema.menus)
        .where(or(eq(schema.menus.id, id), eq(schema.menus.publicId, id)))
        .limit(1);

      if (items.length === 0) {
        return NextResponse.json(
          { error: COMMON_ERRORS.NOT_FOUND, message: '菜单不存在' },
          { status: 404 }
        );
      }

      return NextResponse.json({ data: items[0] });
    } catch (error) {
      console.error('[Menu Detail GET] Failed to fetch menu:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '系统内部错误' },
        { status: 500 }
      );
    }
  });
}

/**
 * PATCH /api/menus/[id]
 * 修改菜单属性
 * 权限要求: menu:update
 * 
 * @param request Next.js 请求对象
 * @param params 路由参数 (Promise<{ id: string }>)
 * @returns 操作结果 JSON 响应
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  return withPermission(request, { permissions: ['menu:update'] }, async () => {
    try {
      const { id } = await params;
      const body = await request.json();
      const { name, path, permissionCode, icon, sort, visible, status, menuType, parentId } = body;

      // 首先校验菜单是否存在
      const items = await db.select({ id: schema.menus.id })
        .from(schema.menus)
        .where(or(eq(schema.menus.id, id), eq(schema.menus.publicId, id)))
        .limit(1);

      if (items.length === 0) {
        return NextResponse.json(
          { error: COMMON_ERRORS.NOT_FOUND, message: '菜单不存在' },
          { status: 404 }
        );
      }

      const updateData: MenuUpdatePayload = { updatedAt: new Date() };
      if (name !== undefined) updateData.name = name;
      if (path !== undefined) updateData.path = path;
      if (permissionCode !== undefined) updateData.permissionCode = permissionCode;
      if (icon !== undefined) updateData.icon = icon;
      if (sort !== undefined) updateData.sort = sort;
      if (visible !== undefined) updateData.visible = visible;
      if (status !== undefined) updateData.status = status;
      if (menuType !== undefined) updateData.menuType = menuType;
      if (parentId !== undefined) updateData.parentId = parentId;

      await db.update(schema.menus)
        .set(updateData)
        .where(or(eq(schema.menus.id, id), eq(schema.menus.publicId, id)));

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('[Menu Detail PATCH] Failed to update menu:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '系统内部错误' },
        { status: 500 }
      );
    }
  });
}

/**
 * DELETE /api/menus/[id]
 * 递归删除菜单及其所有子项
 * 权限要求: menu:delete
 * 
 * @param request Next.js 请求对象
 * @param params 路由参数 (Promise<{ id: string }>)
 * @returns 操作结果 JSON 响应
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  return withPermission(request, { permissions: ['menu:delete'] }, async () => {
    try {
      const { id } = await params;
      
      // 获取菜单 ID (处理 publicId)
      const items = await db.select({ id: schema.menus.id }).from(schema.menus)
        .where(or(eq(schema.menus.id, id), eq(schema.menus.publicId, id)))
        .limit(1);

      if (items.length === 0) {
        return NextResponse.json(
          { error: COMMON_ERRORS.NOT_FOUND, message: '菜单不存在' },
          { status: 404 }
        );
      }

      const rootId = items[0]!.id;

      /**
       * 递归删除菜单和关联子菜单的内置函数
       * @param parentId 菜单父级ID
       */
      const deleteRecursive = async (parentId: string) => {
        // 查找子菜单
        const children = await db.select({ id: schema.menus.id })
          .from(schema.menus)
          .where(eq(schema.menus.parentId, parentId));
        
        // 递归删除子菜单
        for (const child of children) {
          await deleteRecursive(child.id);
        }

        // 删除当前菜单
        await db.delete(schema.menus).where(eq(schema.menus.id, parentId));
      };

      await deleteRecursive(rootId);

      return NextResponse.json({ success: true, message: '菜单及其子项已递归删除' });
    } catch (error) {
      console.error('[Menu Detail DELETE] Failed to delete menu recursively:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '系统内部错误' },
        { status: 500 }
      );
    }
  });
}
