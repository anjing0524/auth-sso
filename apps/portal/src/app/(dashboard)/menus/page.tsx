import { Menu } from 'lucide-react';
import { connection } from 'next/server';
import { getMenuManagementData } from './data';
import MenuManager from './components/MenuManager';

export default async function MenusPage() {
  await connection();
  const data = await getMenuManagementData();

  return (
    <div className="space-y-8 pb-10">
      <div className="space-y-1 px-1">
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
          <Menu className="size-8 text-primary" /> 菜单管理
        </h1>
        <p className="text-sm text-muted-foreground">
          维护侧边栏目录、页面路径和显式权限绑定。
        </p>
      </div>
      <MenuManager {...data} />
    </div>
  );
}
