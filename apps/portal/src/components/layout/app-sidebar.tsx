'use client';

import * as React from 'react';
import * as Icons from 'lucide-react';
import {
  Search,
  ChevronRight,
  LogOut,
  Settings,
  User,
  ShieldCheck,
  LayoutGrid,
  Menu as MenuIcon
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const DynamicIcon = ({ name, className }: { name: string; className?: string }) => {
  const IconComponent = (Icons as any)[name] || LayoutGrid;
  return <IconComponent className={className} />;
};

export function AppSidebar({ user, dynamicMenus = [] }: { user: any; dynamicMenus?: any[] }) {
  const pathname = usePathname();
  const userData = user?.user || {};

  // 内置菜单作为兜底，当数据库为空时使用
  const fallbackMenus = [
    { id: 'dash', title: '工作台', url: '/dashboard', icon: 'LayoutDashboard' },
    { id: 'user', title: '用户管理', url: '/users', icon: 'Users' },
    { id: 'dept', title: '组织架构', url: '/departments', icon: 'Building2' },
    { id: 'role', title: '权限配置', url: '/roles', icon: 'ShieldCheck' },
    { id: 'app', title: '应用管理', url: '/clients', icon: 'AppWindow' },
    { id: 'menu', title: '菜单配置', url: '/menus', icon: 'Menu' },
    { id: 'audit', title: '安全审计', url: '/audit-logs', icon: 'ShieldAlert' },
  ];

  // dynamicMenus 来自 /api/me/menus，已按权限过滤；为空则用内置菜单兜底
  const displayMenus = dynamicMenus.length > 0 ? dynamicMenus : fallbackMenus;

  return (
    <Sidebar collapsible="icon" className="border-r border-border/40 bg-slate-50/50 dark:bg-slate-950/50">
      <SidebarHeader className="h-16 flex flex-col justify-center px-4">
        <Link href="/" className="flex items-center gap-3 px-2 group">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-primary-foreground shadow-xl shadow-blue-500/20 group-hover:scale-105 transition-all duration-300">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="font-black text-lg leading-tight tracking-tight text-slate-900 dark:text-white">Auth-SSO</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-blue-600/70 font-black">Identity OS</span>
          </div>
        </Link>
      </SidebarHeader>
      
      <SidebarContent className="px-3 pt-4">
        <div className="px-2 py-2 group-data-[collapsible=icon]:hidden">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground opacity-50" />
            <Input 
              placeholder="搜索功能..." 
              className="pl-9 h-9 bg-white dark:bg-slate-900 border-none shadow-inner rounded-xl text-xs focus-visible:ring-1 focus-visible:ring-primary/10"
            />
          </div>
        </div>

        <SidebarGroup>
          <SidebarGroupLabel className="px-4 text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 mb-2 group-data-[collapsible=icon]:hidden">
            System Control
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {displayMenus.map((item: any) => {
                const hasChildren = item.children && item.children.length > 0;
                const isActive = pathname === item.url || (item.url !== '/' && pathname.startsWith(item.url));

                if (hasChildren) {
                  return (
                    <Collapsible key={item.id} defaultOpen={isActive} className="group/collapsible">
                      <SidebarMenuItem>
                        <CollapsibleTrigger render={<SidebarMenuButton tooltip={item.title} className="h-11 rounded-xl" />}>
                          <DynamicIcon name={item.icon || 'LayoutGrid'} className="h-5 w-5" />
                          <span className="font-bold">{item.title}</span>
                          <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 text-slate-300" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub className="ml-4 border-l-2 border-slate-100 dark:border-slate-800">
                            {item.children.map((sub: any) => (
                              <SidebarMenuSubItem key={sub.id}>
                                <SidebarMenuSubButton asChild isActive={pathname === sub.url} className="h-9 rounded-lg px-4">
                                  <Link href={sub.url}>
                                    <span className="font-medium text-xs">{sub.title}</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  );
                }

                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                      className={`h-11 rounded-xl transition-all duration-300 ${
                        isActive 
                          ? 'bg-white dark:bg-slate-900 shadow-md shadow-slate-200/50 dark:shadow-none ring-1 ring-slate-200 dark:ring-slate-800 text-primary' 
                          : 'hover:bg-white hover:shadow-sm text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      <Link href={item.url} className="flex items-center gap-3">
                        <DynamicIcon name={item.icon || 'LayoutGrid'} className={`h-4.5 w-4.5 ${isActive ? 'text-blue-600' : 'opacity-60'}`} />
                        <span className={`text-sm ${isActive ? 'font-black' : 'font-bold'}`}>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 bg-slate-50/80 dark:bg-slate-950/80 border-t border-border/40">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="w-full hover:bg-white hover:shadow-md transition-all duration-300 rounded-2xl h-14 border border-transparent hover:border-border/50"
                >
                  <Avatar className="h-9 w-9 rounded-xl border-2 border-white dark:border-slate-800 shadow-sm ring-1 ring-border/20">
                    <AvatarImage src={userData.picture} />
                    <AvatarFallback className="bg-gradient-to-br from-blue-500 to-blue-700 text-white text-xs font-black">
                      {userData.name?.charAt(0) || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden ml-3">
                    <span className="truncate font-black text-slate-900 dark:text-white leading-none mb-1">{userData.name}</span>
                    <span className="truncate text-[10px] text-muted-foreground opacity-70">{userData.email}</span>
                  </div>
                  <MenuIcon className="h-4 w-4 ml-auto opacity-30 group-data-[collapsible=icon]:hidden" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-64 rounded-[1.5rem] p-3 shadow-2xl border-border/40 animate-in zoom-in-95 duration-300"
                side="right"
                align="end"
                sideOffset={16}
              >
                <div className="px-3 py-3 mb-2 bg-slate-50 dark:bg-slate-900 rounded-2xl">
                   <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-1">Authenticated Account</p>
                   <p className="text-xs font-bold text-slate-500 truncate">{userData.email}</p>
                </div>
                <DropdownMenuItem asChild className="rounded-xl cursor-pointer">
                  <Link href="/profile" className="flex items-center gap-3 py-3 px-3 hover:bg-primary/5">
                    <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><User className="h-4 w-4" /></div>
                    <span className="font-bold text-sm text-slate-700">个人中心</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="rounded-xl cursor-pointer">
                  <Link href="/settings" className="flex items-center gap-3 py-3 px-3 hover:bg-slate-50">
                    <div className="p-2 bg-slate-100 text-slate-600 rounded-lg"><Settings className="h-4 w-4" /></div>
                    <span className="font-bold text-sm text-slate-700">系统设置</span>
                  </Link>
                </DropdownMenuItem>
                <div className="h-px bg-slate-100 dark:bg-slate-800 my-2 mx-2" />
                <DropdownMenuItem asChild className="rounded-xl cursor-pointer text-destructive focus:bg-destructive/5 focus:text-destructive">
                  <a href="/api/auth/logout" className="flex items-center gap-3 py-3 px-3">
                    <div className="p-2 bg-destructive/10 text-destructive rounded-lg"><LogOut className="h-4 w-4" /></div>
                    <span className="font-black text-sm uppercase tracking-tight">Sign Out</span>
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
