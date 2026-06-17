/**
 * 菜单详情与操作 API 路由处理器
 * GET /api/menus/[id] — 委托 data.ts 获取菜单详情
 * PATCH /api/menus/[id] — 修改菜单
 * DELETE /api/menus/[id] — 递归删除菜单
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { withPermission } from '@/lib/auth';
import { COMMON_ERRORS, EntityStatus } from '@auth-sso/contracts';
import { getMenuById } from '@/app/menus/data';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }>; }
interface MenuUpdatePayload {
  name?: string; path?: string | null; permissionCode?: string | null;
  icon?: string | null; sort?: number; visible?: boolean;
  status?: EntityStatus; menuType?: 'DIRECTORY' | 'MENU' | 'BUTTON';
  parentId?: string | null; updatedAt: Date;
}

/** GET /api/menus/[id] — 委托 data.ts */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['menu:list'] }, async () => {
    const { id } = await params;
    const menu = await getMenuById(id);
    if (!menu) return NextResponse.json({ error: COMMON_ERRORS.NOT_FOUND, message: '菜单不存在' }, { status: 404 });
    return NextResponse.json({ data: menu });
  });
}

/** PATCH /api/menus/[id] — 修改菜单 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['menu:update'] }, async () => {
    const { id } = await params;
    const body = await request.json();
    const { name, path, permissionCode, icon, sort, visible, status, menuType, parentId } = body;

    const menu = await getMenuById(id);
    if (!menu) return NextResponse.json({ error: COMMON_ERRORS.NOT_FOUND, message: '菜单不存在' }, { status: 404 });

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

    await db.update(schema.menus).set(updateData).where(eq(schema.menus.id, menu.id));
    return NextResponse.json({ success: true });
  });
}

/** DELETE /api/menus/[id] — 递归删除菜单 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['menu:delete'] }, async () => {
    const { id } = await params;
    const menu = await getMenuById(id);
    if (!menu) return NextResponse.json({ error: COMMON_ERRORS.NOT_FOUND, message: '菜单不存在' }, { status: 404 });

    const rootId = menu.id;
    const deleteRecursive = async (parentId: string) => {
      const children = await db.select({ id: schema.menus.id }).from(schema.menus).where(eq(schema.menus.parentId, parentId));
      for (const child of children) await deleteRecursive(child.id);
      await db.delete(schema.menus).where(eq(schema.menus.id, parentId));
    };

    await deleteRecursive(rootId);
    return NextResponse.json({ success: true, message: '菜单及其子项已递归删除' });
  });
}
