'use client';

import {
  ChevronRight,
  LogOut,
  Settings,
  User,
  ShieldCheck,
  Menu as MenuIcon,
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { DynamicIcon } from '@/lib/icon-map';

/** 侧边栏菜单项类型 */
interface MenuItem {
  id: string;
  title: string;
  url: string;
  icon: string | null;
  children?: MenuItem[];
}

export function AppSidebar({ user, dynamicMenus = [] }: {
  user: { id?: string; name?: string; email?: string | null; picture?: string | null } | null;
  dynamicMenus?: MenuItem[];
}) {
  const pathname = usePathname();
  const userData = user || {};

  // 内置菜单作为兜底，当数据库为空时使用
  const fallbackMenus: MenuItem[] = [
    { id: 'dash', title: '工作台', url: '/dashboard', icon: 'LayoutDashboard' },
    { id: 'user', title: '用户管理', url: '/users', icon: 'Users' },
    { id: 'dept', title: '组织架构', url: '/departments', icon: 'Building2' },
    { id: 'perm-center', title: '权限中心', url: '', icon: 'ShieldCheck', children: [
      { id: 'role', title: '角色管理', url: '/roles', icon: 'Shield' },
      { id: 'perm', title: '权限管理', url: '/permissions', icon: 'Key' },
    ]},
    { id: 'app', title: '应用管理', url: '/clients', icon: 'AppWindow' },
    { id: 'audit', title: '安全审计', url: '/audit-logs', icon: 'ShieldAlert' },
  ];

  // dynamicMenus 来自服务端，已按权限过滤；为空则用内置菜单兜底
  const displayMenus: MenuItem[] = dynamicMenus.length > 0 ? dynamicMenus : fallbackMenus;

  return (
    <Sidebar collapsible="icon" className="border-r border-border/40 bg-muted/30">
      <SidebarHeader className="h-16 flex flex-col justify-center px-4">
        <Link href="/" className="flex items-center gap-3 px-2 group">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-hover text-primary-foreground shadow-xl shadow-primary/20 group-hover:scale-105 transition-all duration-300">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="font-black text-lg leading-tight tracking-tight text-foreground">Auth-SSO</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-primary/70 font-black">Identity OS</span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-3 pt-4">
        <SidebarGroup>
          <SidebarGroupLabel className="px-4 text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground mb-2 group-data-[collapsible=icon]:hidden">
            System Control
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {displayMenus.map((item: MenuItem) => {
                const hasChildren = item.children && item.children.length > 0;
                const isActive = pathname === item.url || (item.url !== '/' && pathname.startsWith(item.url));

                if (hasChildren) {
                  return (
                    <Collapsible key={item.id} defaultOpen={isActive} className="group/collapsible">
                      <SidebarMenuItem>
                        <CollapsibleTrigger render={<SidebarMenuButton tooltip={item.title} className="h-11 rounded-xl" />}>
                          <DynamicIcon name={item.icon || 'LayoutGrid'} className="h-5 w-5" />
                          <span className="font-bold">{item.title}</span>
                          <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 text-muted-foreground/60" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub className="ml-4 border-l-2 border-border">
                            {item.children?.map((sub: MenuItem) => (
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
                          ? 'bg-card shadow-md ring-1 ring-border text-primary'
                          : 'hover:bg-card hover:shadow-sm text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Link href={item.url} className="flex items-center gap-3">
                        <DynamicIcon name={item.icon || 'LayoutGrid'} className={`h-4.5 w-4.5 ${isActive ? 'text-primary' : 'opacity-60'}`} />
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

      <SidebarFooter className="p-4 bg-muted/80 border-t border-border/40">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="w-full hover:bg-card hover:shadow-md transition-all duration-300 rounded-2xl h-14 border border-transparent hover:border-border/50"
                >
                  <Avatar className="h-9 w-9 rounded-xl border-2 border-card ring-1 ring-border/20 shadow-sm">
                    <AvatarImage src={userData.picture ?? undefined} />
                    <AvatarFallback className="bg-gradient-to-br from-primary to-primary/70 text-primary-foreground text-xs font-black">
                      {userData.name?.charAt(0) || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden ml-3">
                    <span className="truncate font-black text-foreground leading-none mb-1">{userData.name}</span>
                    <span className="truncate text-[10px] text-muted-foreground opacity-70">{userData.email}</span>
                  </div>
                  <MenuIcon className="h-4 w-4 ml-auto opacity-30 group-data-[collapsible=icon]:hidden" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-64 rounded-xl p-3 shadow-2xl border-border/40 animate-in zoom-in-95 duration-300"
                side="right"
                align="end"
                sideOffset={16}
              >
                <div className="px-3 py-3 mb-2 bg-muted rounded-2xl">
                   <p className="text-[10px] font-black text-primary uppercase tracking-widest mb-1">Authenticated Account</p>
                   <p className="text-xs font-bold text-muted-foreground truncate">{userData.email}</p>
                </div>
                <DropdownMenuItem asChild className="rounded-xl cursor-pointer">
                  <Link href="/profile" className="flex items-center gap-3 py-3 px-3 hover:bg-primary/5">
                    <div className="p-2 bg-primary/10 text-primary rounded-lg"><User className="h-4 w-4" /></div>
                    <span className="font-bold text-sm text-foreground">个人中心</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="rounded-xl cursor-pointer">
                  <Link href="/profile" className="flex items-center gap-3 py-3 px-3 hover:bg-muted">
                    <div className="p-2 bg-muted text-muted-foreground rounded-lg"><Settings className="h-4 w-4" /></div>
                    <span className="font-bold text-sm text-foreground">系统设置</span>
                  </Link>
                </DropdownMenuItem>
                <div className="h-px bg-border my-2 mx-2" />
                <DropdownMenuItem asChild className="rounded-xl cursor-pointer text-destructive focus:bg-destructive/5 focus:text-destructive">
                  <a href="/api/auth/logout?callbackUrl=/login" className="flex items-center gap-3 py-3 px-3">
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
