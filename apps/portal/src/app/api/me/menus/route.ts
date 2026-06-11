/**
 * 当前用户可见侧边栏菜单树 API 路由端点
 *
 * GET /api/me/menus - 返回当前登录用户经权限过滤后的树形菜单结构（仅限侧边栏可见菜单，排除了按钮级权限项）
 */
import { NextRequest, NextResponse } from 'next/server';
import { getJwtFromCookie, verifyJwt } from '@/lib/session';
import { getUserPermissionContext } from '@/lib/permissions';
import { db, schema } from '@/lib/db';
import { asc, eq } from 'drizzle-orm';
import { COMMON_ERRORS } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * 侧边栏菜单项接口定义
 */
interface SidebarMenuItem {
  id: string;
  parentId: string | null;
  title: string;
  url: string;
  icon: string;
  sort: number;
  children?: SidebarMenuItem[];
}

/**
 * 将平铺的菜单项列表递归构建为树形结构，并按 sort 排序
 *
 * @param items 平铺菜单列表
 * @param parentId 父级菜单ID
 * @returns 树状结构的菜单项列表
 */
function buildTree(items: SidebarMenuItem[], parentId: string | null = null): SidebarMenuItem[] {
  return items
    .filter(item => item.parentId === parentId)
    .map(item => ({ ...item, children: buildTree(items, item.id) }))
    .sort((a, b) => a.sort - b.sort);
}

/**
 * GET /api/me/menus
 * 获取当前已登录用户有权访问的、启用状态下的侧边栏可见菜单树
 *
 * @param request NextRequest 对象
 * @returns JSON 响应，包含树形侧边栏菜单列表
 */
export async function GET(request: NextRequest) {
  try {
    // 1. 从 JWT Cookie 验签获取用户身份
    const token = await getJwtFromCookie();
    if (!token) {
      return NextResponse.json(
        { error: COMMON_ERRORS.UNAUTHORIZED, message: '未登录' },
        { status: 401 }
      );
    }

    const claims = await verifyJwt(token);
    if (!claims) {
      return NextResponse.json(
        { error: COMMON_ERRORS.UNAUTHORIZED, message: '登录已过期' },
        { status: 401 }
      );
    }

    // 2. 联动查询获取当前用户的角色及权限集上下文
    const ctx = await getUserPermissionContext(claims.sub);
    if (!ctx) {
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '无法获取用户权限上下文' },
        { status: 500 }
      );
    }

    // 3. 超管权限判断：SUPER_ADMIN 与 ADMIN 无需过滤，拥有系统全量可见菜单的完全访问权
    const isAdmin = ctx.roles.some(r => r.code === 'SUPER_ADMIN' || r.code === 'ADMIN');

    // 4. 查询数据库中所有启用状态下的系统菜单
    const allMenus = await db.select()
      .from(schema.menus)
      .where(eq(schema.menus.status, 'ACTIVE'))
      .orderBy(asc(schema.menus.sort));

    // 5. 进行前置过滤：
    // - 按钮级别的按钮菜单类型不应当在侧边栏显示；
    // - 过滤隐藏菜单；
    // - 没有任何权限编码要求的目录/菜单，所有人均默认可见；
    // - 有权限编码要求的，需比对用户当前拥有的权限编码集。
    const visible = allMenus.filter(m => {
      if (m.menuType === 'BUTTON') return false;
      if (!m.visible) return false;
      if (!m.permissionCode) return true;
      if (isAdmin) return true;
      return ctx.permissions.includes(m.permissionCode);
    });

    // 6. 将数据库实体结构映射转换为侧边栏菜单项所需的统一前端视图数据结构
    const mapped: SidebarMenuItem[] = visible.map(m => ({
      id: m.id,
      parentId: m.parentId,
      title: m.name,
      url: m.path || '#',
      icon: m.icon || 'LayoutGrid',
      sort: m.sort ?? 0,
    }));

    // 7. 进行树形层级组装并返回
    return NextResponse.json({ data: buildTree(mapped) });
  } catch (error) {
    // 捕获系统级异常进行后台记录，前台脱敏处理，提升架构稳健度
    console.error('[Me Menus GET] Failed to construct visible sidebar menu tree:', error);
    return NextResponse.json(
      { error: COMMON_ERRORS.INTERNAL_ERROR, message: '获取侧边栏菜单失败' },
      { status: 500 }
    );
  }
}

