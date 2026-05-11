/**
 * 权限详情与修改 API
 * GET /api/permissions/[id] - 获取权限详情
 * PATCH /api/permissions/[id] - 修改权限
 * DELETE /api/permissions/[id] - 删除权限
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, or } from 'drizzle-orm';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

/**
 * GET /api/permissions/[id]
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withPermission(request, { permissions: ['permission:list'] }, async () => {
    const { id } = await params;
    const items = await db.select().from(schema.permissions)
      .where(or(eq(schema.permissions.id, id), eq(schema.permissions.publicId, id)))
      .limit(1);

    if (items.length === 0) {
      return NextResponse.json({ error: 'not_found', message: '权限不存在' }, { status: 404 });
    }

    return NextResponse.json({ data: items[0] });
  });
}

/**
 * PATCH /api/permissions/[id]
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withPermission(request, { permissions: ['permission:update'] }, async () => {
    const { id } = await params;
    const body = await request.json();
    
    await db.update(schema.permissions)
      .set({ ...body, updatedAt: new Date() })
      .where(or(eq(schema.permissions.id, id), eq(schema.permissions.publicId, id)));

    return NextResponse.json({ success: true });
  });
}

/**
 * DELETE /api/permissions/[id]
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withPermission(request, { permissions: ['permission:delete'] }, async () => {
    const { id } = await params;
    
    await db.delete(schema.permissions)
      .where(or(eq(schema.permissions.id, id), eq(schema.permissions.publicId, id)));

    return NextResponse.json({ success: true });
  });
}
