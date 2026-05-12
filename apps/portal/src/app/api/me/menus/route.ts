/**
 * 当前用户可见菜单 API
 * GET /api/me/menus - 返回权限过滤后的菜单树（供侧边栏使用）
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionIdFromCookie, getSession } from '@/lib/session';
import { getUserPermissionContext } from '@/lib/permissions';
import { db, schema } from '@/lib/db';
import { asc, eq } from 'drizzle-orm';

export const runtime = 'nodejs';

interface SidebarMenuItem {
  id: string;
  parentId: string | null;
  title: string;
  url: string;
  icon: string;
  sort: number;
  children?: SidebarMenuItem[];
}

/** 将平铺列表构建为树形结构 */
function buildTree(items: SidebarMenuItem[], parentId: string | null = null): SidebarMenuItem[] {
  return items
    .filter(item => item.parentId === parentId)
    .map(item => ({ ...item, children: buildTree(items, item.id) }))
    .sort((a, b) => a.sort - b.sort);
}

export async function GET(_request: NextRequest) {
  // 验证 session
  const sessionId = await getSessionIdFromCookie();
  if (!sessionId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const session = await getSession(sessionId);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // 获取用户权限上下文
  const ctx = await getUserPermissionContext(session.userId);
  if (!ctx) return NextResponse.json({ error: 'internal_error' }, { status: 500 });

  const isAdmin = ctx.roles.some(r => r.code === 'SUPER_ADMIN' || r.code === 'ADMIN');

  // 查询所有启用且可见的非按钮菜单
  const allMenus = await db.select()
    .from(schema.menus)
    .where(eq(schema.menus.status, 'ACTIVE'))
    .orderBy(asc(schema.menus.sort));

  // 过滤：按钮不显示在侧边栏；无权限码的目录/菜单总是显示
  const visible = allMenus.filter(m => {
    if ((m as any).menuType === 'BUTTON') return false;
    if (!m.visible) return false;
    if (!m.permissionCode) return true;
    if (isAdmin) return true;
    return ctx.permissions.includes(m.permissionCode);
  });

  // 转换为侧边栏所需格式
  const mapped: SidebarMenuItem[] = visible.map(m => ({
    id: m.id,
    parentId: m.parentId,
    title: m.name,
    url: m.path || '#',
    icon: m.icon || 'LayoutGrid',
    sort: m.sort ?? 0,
  }));

  return NextResponse.json({ data: buildTree(mapped) });
}
