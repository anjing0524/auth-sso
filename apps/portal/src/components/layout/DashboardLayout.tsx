'use client';

/**
 * Dashboard 布局 — 客户端壳（侧边栏状态、面包屑导航）
 *
 * 用户数据和菜单由 Server Component (dashboard)/layout.tsx 服务端获取并通过 props 传入，
 * 不再在客户端 useEffect + fetch('/api/me')，消灭客户端数据瀑布。
 */
import React from 'react';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from './app-sidebar';
import { Separator } from '@/components/ui/separator';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { usePathname } from 'next/navigation';

/** 侧边栏菜单项 */
export interface SidebarMenuItem {
  id: string;
  title: string;
  url: string;
  icon: string | null;
  children?: SidebarMenuItem[];
}

/** 服务端传入的用户 + 菜单数据 */
export interface DashboardProps {
  user: {
    id: string;
    email: string | null;
    name: string;
    picture: string | null;
    emailVerified: boolean | null;
  };
  menus: SidebarMenuItem[];
}

export default function DashboardLayout({
  user,
  menus,
  children,
}: DashboardProps & { children: React.ReactNode }) {
  const pathname = usePathname();

  const getBreadcrumbs = () => {
    const segments = pathname.split('/').filter(Boolean);
    const crumbs = [{ title: '工作台', url: '/dashboard' }];

    if (segments[0] !== 'dashboard') {
      const titleMap: Record<string, string> = {
        users: '用户管理',
        roles: '角色权限',
        departments: '组织架构',
        clients: '应用管理',
        'audit-logs': '审计日志',
        permissions: '权限管理',
        menus: '菜单配置',
      };
      const title = titleMap[segments[0]] || segments[0];
      crumbs.push({ title, url: `/${segments[0]}` });
    }

    return crumbs;
  };

  const breadcrumbs = getBreadcrumbs();

  return (
    <SidebarProvider defaultOpen={true}>
      <AppSidebar user={user} dynamicMenus={menus} />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b bg-background px-6 sticky top-0 z-10">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbs.map((crumb, index) => (
                <React.Fragment key={crumb.url}>
                  <BreadcrumbItem className="hidden md:block">
                    {index === breadcrumbs.length - 1 ? (
                      <BreadcrumbPage>{crumb.title}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink href={crumb.url}>{crumb.title}</BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {index < breadcrumbs.length - 1 && (
                    <BreadcrumbSeparator className="hidden md:block" />
                  )}
                </React.Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <main className="flex-1 overflow-auto bg-slate-50/50 dark:bg-transparent p-4 lg:p-6">
          <div className="space-y-6 animate-in fade-in duration-500">
            {children}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
