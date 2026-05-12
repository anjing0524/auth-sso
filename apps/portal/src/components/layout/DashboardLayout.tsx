'use client';

import React, { useState, useEffect } from 'react';
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
import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [userInfo, setUserInfo] = useState<any>(null);
  const [dynamicMenus, setDynamicMenus] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();

  useEffect(() => {
    async function fetchData() {
      try {
        const [meRes, menusRes] = await Promise.all([
          fetch('/api/me'),
          fetch('/api/me/menus'),
        ]);
        if (meRes.ok) {
          const data = await meRes.json();
          setUserInfo(data);
        }
        if (menusRes.ok) {
          const data = await menusRes.json();
          setDynamicMenus(data.data || []);
        }
      } catch (error) {
        console.error('Failed to fetch layout data:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // 生成面包屑
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

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-full" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider defaultOpen={true}>
      <AppSidebar user={userInfo} dynamicMenus={dynamicMenus} />
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
