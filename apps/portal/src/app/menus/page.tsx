/**
 * 菜单管理页面 — Server Component 读模型入口
 * 写操作通过 Server Actions (actions.ts) 执行
 */
import { headers } from 'next/headers';
import { Menu } from 'lucide-react';
import { checkPermission } from '@/lib/auth';
import { getMenus } from './data';
import MenuTree from './components/MenuTree';

export default async function MenusPage() {
  const auth = await checkPermission(await headers(), { permissions: ['menu:list'] });
  if (!auth.authorized || !auth.userId) {
    return <div className="flex items-center justify-center h-64"><p className="text-red-500">未授权访问或权限不足</p></div>;
  }

  const menus = await getMenus();

  return (
    <div className="space-y-8 pb-10">
      <div className="flex items-center justify-between px-1">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Menu className="h-8 w-8 text-primary" /> 菜单管理
          </h1>
          <p className="text-muted-foreground text-sm">管理系统导航菜单，支持目录/菜单/按钮三种类型及无限层级。</p>
        </div>
      </div>
      <MenuTree menus={menus} />
    </div>
  );
}
