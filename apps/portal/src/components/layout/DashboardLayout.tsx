'use client';

/**
 * Dashboard 布局 — 客户端壳（侧边栏状态、面包屑导航）
 *
 * 用户数据和菜单由 Server Component (dashboard)/layout.tsx 服务端获取并通过 props 传入，
 * 不再在客户端 useEffect + fetch('/api/me')，消灭客户端数据瀑布。
 */
import React, { useEffect, useMemo, useRef } from 'react';
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
import { CommandPaletteTrigger } from './command-palette-trigger';
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
  const initialRenderRef = useRef(true);

  // SPA 路由切换后把焦点移回主内容，读屏用户能直接进入新页面；
  // 初次挂载不抢焦点（首屏仍从 skip link/导航开始）。
  useEffect(() => {
    if (initialRenderRef.current) {
      initialRenderRef.current = false;
      return;
    }
    requestAnimationFrame(() => document.getElementById('main-content')?.focus());
  }, [pathname]);

  const breadcrumbs = useMemo(() => {
    const segments = pathname.split('/').filter(Boolean);
    const crumbs = [{ title: '工作台', url: '/dashboard' }];

    if (segments[0] !== 'dashboard') {
      const titleMap: Record<string, string> = {
        users: '用户管理',
        roles: '角色管理',
        departments: '部门管理',
        clients: '应用管理',
        'audit-logs': '审计日志',
        permissions: '权限管理',
        profile: '个人中心',
        menus: '菜单配置',
      };
      const title = titleMap[segments[0]!] || segments[0] || '';
      crumbs.push({ title, url: `/${segments[0]}` });
      // 角色权限配置页（/roles/:id/permissions）：补一级可读面包屑
      if (segments[0] === 'roles' && segments[2] === 'permissions') {
        crumbs.push({ title: '配置权限', url: pathname });
      }
      if (segments[0] === 'users' && segments[2] === 'roles') {
        crumbs.push({ title: '分配角色', url: pathname });
      } else if (segments[0] === 'users' && segments[1]) {
        crumbs.push({ title: '用户详情', url: pathname });
      }
      if (segments[0] === 'clients' && segments[1] === 'new') {
        crumbs.push({ title: '注册应用', url: pathname });
      } else if (segments[0] === 'clients' && segments[1]) {
        crumbs.push({ title: '应用详情', url: pathname });
      }
      if (segments[0] === 'audit-logs' && segments[1]) {
        crumbs.push({ title: '审计日志详情', url: pathname });
      }
      if (segments[0] === 'permissions' && segments[1] === 'new') {
        crumbs.push({ title: '新建权限', url: pathname });
      }
      if (segments[0] === 'permissions' && segments[2] === 'edit') {
        crumbs.push({ title: '编辑权限', url: pathname });
      }
    }

    return crumbs;
  }, [pathname]);

  return (
    <SidebarProvider defaultOpen={true} className="h-svh overflow-hidden">
      {/* WCAG 2.1 AA: skip-link — 键盘用户快速跳过导航 */}
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:shadow-lg">
        跳转到主内容
      </a>
      <AppSidebar user={user} dynamicMenus={menus} />
      <CommandPalette menus={menus} />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4 sticky top-0 z-10">
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
            <CommandPaletteTrigger />
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-muted/30 p-3 lg:px-4 lg:py-3" style={{ height: 'calc(100svh - 3rem)' }}>
          {/* 主内容区自身是滚动容器：列表页 flex-1 填满可视高度（表格内部滚动、分页固定在底部），
              详情页/工作台内容超出时在同一个容器内滚动 */}
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
            {children}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
