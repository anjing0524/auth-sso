'use client';

/**
 * Dashboard 布局 — 客户端壳（侧边栏状态、面包屑导航）
 *
 * 用户数据和菜单由 Server Component (dashboard)/layout.tsx 服务端获取并通过 props 传入，
 * 不再在客户端 useEffect + fetch('/api/me')，消灭客户端数据瀑布。
 */
import React, { useMemo } from 'react';
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
import { Keyboard } from 'lucide-react';
import { CommandPalette } from '@/components/shared/command-palette';

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

  const breadcrumbs = useMemo(() => {
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
  }, [pathname]);

  return (
    <SidebarProvider defaultOpen={true}>
      {/* WCAG 2.1 AA: skip-link — 键盘用户快速跳过导航 */}
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:shadow-lg">
        跳转到主内容
      </a>
      <AppSidebar user={user} dynamicMenus={menus} />
      <CommandPalette menus={menus} />
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
          <div className="ml-auto flex items-center gap-2">
            <kbd className="hidden md:inline-flex h-6 select-none items-center gap-1 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
              <Keyboard className="h-3 w-3" />K
            </kbd>
          </div>
        </header>
        <main id="main-content" className="flex-1 overflow-auto bg-muted/30 p-4 lg:p-6">
          <div className="space-y-6 animate-in fade-in duration-500">
            {children}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
