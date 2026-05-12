/**
 * 菜单管理 API
 * GET /api/menus - 获取所有菜单（不分页，树形或列表）
 * POST /api/menus - 创建菜单项
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { asc, eq } from 'drizzle-orm';
import { withPermission } from '@/lib/auth-middleware';
import crypto from 'crypto';

export const runtime = 'nodejs';

/**
 * GET /api/menus
 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['menu:list'] }, async () => {
    try {
      const allMenus = await db.select()
        .from(schema.menus)
        .orderBy(asc(schema.menus.sort));

      return NextResponse.json({ data: allMenus });
    } catch (error) {
      console.error('[Menus] GET Error:', error);
      return NextResponse.json({ error: 'internal_error' }, { status: 500 });
    }
  });
}

/**
 * POST /api/menus
 */
export async function POST(request: NextRequest) {
  return withPermission(request, { permissions: ['menu:create'] }, async () => {
    try {
      const body = await request.json();
      const { name, path, permissionCode, parentId, icon, sort = 0, visible = true, status = 'ACTIVE', menuType = 'MENU' } = body;

      if (!name) {
        return NextResponse.json({ error: 'invalid_params', message: '菜单名称不能为空' }, { status: 400 });
      }

      const id = crypto.randomUUID();
      const publicId = `menu_${Date.now().toString(36)}`;

      await db.insert(schema.menus).values({
        id,
        publicId,
        parentId: parentId ?? null,
        name,
        path: path ?? null,
        permissionCode: permissionCode ?? null,
        icon: icon ?? null,
        sort,
        visible,
        menuType: menuType as 'DIRECTORY' | 'MENU' | 'BUTTON',
        status: status as 'ACTIVE' | 'DISABLED',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return NextResponse.json({ success: true, data: { id, publicId, name, path } });
    } catch (error) {
      console.error('[Menus] POST Error:', error);
      return NextResponse.json({ error: 'internal_error' }, { status: 500 });
    }
  });
}
