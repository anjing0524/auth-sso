/**
 * 菜单管理 API 路由处理器
 * @module apps/portal/api/menus
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { asc } from 'drizzle-orm';
import { withPermission } from '@/lib/auth-middleware';
import { generateUUID } from '@/lib/crypto';
import { COMMON_ERRORS, EntityStatus } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * GET /api/menus
 * 获取全量菜单列表（不分页，主要供树形前端使用）
 * 权限要求: menu:list
 * 
 * @param request Next.js 请求对象
 * @returns 菜单列表 JSON 响应
 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['menu:list'] }, async () => {
    try {
      const allMenus = await db.select()
        .from(schema.menus)
        .orderBy(asc(schema.menus.sort));

      return NextResponse.json({ data: allMenus });
    } catch (error: any) {
      console.error('[Menus] GET Error:', error.message);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '获取菜单列表失败' }, 
        { status: 500 }
      );
    }
  });
}

/**
 * POST /api/menus
 * 创建新菜单项
 * 权限要求: menu:create
 * 
 * @param request Next.js 请求对象
 * @returns 创建成功的菜单数据 JSON 响应
 */
export async function POST(request: NextRequest) {
  return withPermission(request, { permissions: ['menu:create'] }, async () => {
    try {
      const body = await request.json();
      const { name, path, permissionCode, parentId, icon, sort = 0, visible = true, status = 'ACTIVE', menuType = 'MENU' } = body;

      // 校验必填项
      if (!name) {
        return NextResponse.json(
          { error: COMMON_ERRORS.VALIDATION_ERROR, message: '菜单名称不能为空' }, 
          { status: 400 }
        );
      }

      // 统一采用全局 UUID 安全生成工具
      const id = generateUUID();
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
        status: status as EntityStatus,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return NextResponse.json({ success: true, data: { id, publicId, name, path } });
    } catch (error: any) {
      console.error('[Menus] POST Error:', error.message);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: `创建菜单失败: ${error.message}` }, 
        { status: 500 }
      );
    }
  });
}

