/**
 * 菜单管理 API (REST 薄 Controller)
 *
 * GET 读操作委托给 menus/data.ts 统一读模型，消除重复 Drizzle 查询。
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/auth';
import { getMenus } from '@/app/(dashboard)/menus/data';

export const runtime = 'nodejs';

/** GET /api/menus — 委托 data.ts 获取全量菜单树 */
export async function GET(request: NextRequest) {
  return withPermission({ permissions: ['menu:list'] }, async () => {
    const data = await getMenus();
    return NextResponse.json({ data });
  });
}
