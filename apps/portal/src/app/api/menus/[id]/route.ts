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
    
    await db.update(schema.menus)
      .set({ ...body, updatedAt: new Date() })
      .where(or(eq(schema.menus.id, id), eq(schema.menus.publicId, id)));

    return NextResponse.json({ success: true });
  });
}

/**
 * DELETE /api/menus/[id]
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withPermission(request, { permissions: ['menu:delete'] }, async () => {
    const { id } = await params;
    
    await db.delete(schema.menus)
      .where(or(eq(schema.menus.id, id), eq(schema.menus.publicId, id)));

    return NextResponse.json({ success: true });
  });
}
