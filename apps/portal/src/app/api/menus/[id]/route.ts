/**
 * 菜单详情与修改 API
 * GET /api/menus/[id] - 获取菜单详情
 * PATCH /api/menus/[id] - 修改菜单
 * DELETE /api/menus/[id] - 删除菜单
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, or } from 'drizzle-orm';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

/**
 * GET /api/menus/[id]
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withPermission(request, { permissions: ['menu:list'] }, async () => {
    const { id } = await params;
    const items = await db.select().from(schema.menus)
      .where(or(eq(schema.menus.id, id), eq(schema.menus.publicId, id)))
      .limit(1);

    if (items.length === 0) {
      return NextResponse.json({ error: 'not_found', message: '菜单不存在' }, { status: 404 });
    }

    return NextResponse.json({ data: items[0] });
  });
}

/**
 * PATCH /api/menus/[id]
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withPermission(request, { permissions: ['menu:update'] }, async () => {
    const { id } = await params;
    const body = await request.json();
    const { name, path, permissionCode, icon, sort, visible, status, menuType, parentId } = body;

    const updateData: Record<string, any> = { updatedAt: new Date() };
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
  });
}

/**
 * DELETE /api/menus/[id]
 * 递归删除菜单及其所有子项
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withPermission(request, { permissions: ['menu:delete'] }, async () => {
    const { id } = await params;
    
    // 获取菜单 ID (处理 publicId)
    const items = await db.select({ id: schema.menus.id }).from(schema.menus)
      .where(or(eq(schema.menus.id, id), eq(schema.menus.publicId, id)))
      .limit(1);

    if (items.length === 0) {
      return NextResponse.json({ error: 'not_found', message: '菜单不存在' }, { status: 404 });
    }

    const rootId = items[0]!.id;

    // 递归删除逻辑
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
  });
}
