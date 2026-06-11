/**
 * AppSidebar 侧边栏组件测试
 *
 * AppSidebar 通过 props 接收 user 和 dynamicMenus，不直接调用 hooks 获取数据。
 * dynamicMenus 为空时使用内置 fallbackMenus 兜底。
 *
 * 覆盖场景：
 * - 正常：渲染 dynamicMenus 传入的菜单项
 * - 正常：渲染 user 信息（名称、邮箱、头像 fallback）
 * - 正常：渲染子菜单（children 嵌套菜单）
 * - 边界：dynamicMenus 为空时展示内置 fallbackMenus
 * - 边界：user.user 为空时显示默认头像 'U'
 * - 正常：登录用户下拉菜单渲染个人中心/系统设置/登出
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { AppSidebar } from '@/components/layout/app-sidebar';

// ============================================================
// Mocks
// ============================================================
const mockUsePathname = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: (...args: unknown[]) => mockUsePathname(...args),
}));

// 为了绕过 vite hoist 上下文限制，在 vi.mock 外部定义工厂函数
// 通过 `require('react')` 获取 React.createElement

function makeSidebarMock() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react');
  const h = R.createElement;
  const mc = (name: string, tag = 'div') =>
    (p: any) => h(tag, { 'data-mock': name, className: p?.className }, p?.children);
  return {
    Sidebar: mc('Sidebar'),
    SidebarHeader: mc('SidebarHeader'),
    SidebarContent: mc('SidebarContent'),
    SidebarFooter: mc('SidebarFooter'),
    SidebarMenu: (p: any) => h('ul', { 'data-mock': 'SidebarMenu' }, p?.children),
    SidebarMenuItem: (p: any) => h('li', { 'data-mock': 'SidebarMenuItem' }, p?.children),
    SidebarMenuButton: (p: any) => {
      if (p?.asChild) return p.children;
      return h('button', { 'data-mock': 'SidebarMenuButton' }, p?.children);
    },
    SidebarGroup: mc('SidebarGroup'),
    SidebarGroupLabel: mc('SidebarGroupLabel'),
    SidebarGroupContent: mc('SidebarGroupContent'),
    SidebarMenuSub: (p: any) => h('ul', { 'data-mock': 'SidebarMenuSub' }, p?.children),
    SidebarMenuSubItem: (p: any) => h('li', { 'data-mock': 'SidebarMenuSubItem' }, p?.children),
    SidebarMenuSubButton: (p: any) =>
      h('button', { 'data-mock': 'SidebarMenuSubButton', 'data-active': p?.isActive }, p?.children),
  };
}

function makeDropdownMock() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react');
  const h = R.createElement;
  const div = (name: string) =>
    (p: any) => h('div', { 'data-mock': name, className: p?.className }, p?.children);
  return {
    DropdownMenu: (p: any) => h('div', { 'data-mock': 'DropdownMenu' }, p?.children),
    DropdownMenuTrigger: (p: any) => {
      if (p?.asChild) return p.children;
      return h('button', { 'data-mock': 'DropdownMenuTrigger' }, p?.children);
    },
    DropdownMenuContent: div('DropdownMenuContent'),
    DropdownMenuItem: (p: any) => {
      if (p?.asChild) return p.children;
      return h('div', { 'data-mock': 'DropdownMenuItem' }, p?.children);
    },
  };
}

function makeLinkMock() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react');
  const h = R.createElement;
  return {
    default: (p: any) => h('a', { href: p?.href, className: p?.className }, p?.children),
  };
}

// 将工厂函数包装为匿名函数传递给 vi.mock
// `require('react')` 在这些函数首次调用时才执行，此时模块系统已就绪
vi.mock('next/link', () => makeLinkMock());
vi.mock('@/components/ui/sidebar', () => makeSidebarMock());
vi.mock('@/components/ui/dropdown-menu', () => makeDropdownMock());

// ============================================================
// Tests
// ============================================================
describe('AppSidebar', () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue('/dashboard');
  });

  // ── User info ─────────────────────────────────────────────
  it('renders user name and email from user prop', () => {
    render(
      <AppSidebar
        user={{ user: { name: '张三', email: 'zhangsan@test.com' } }}
        dynamicMenus={[]}
      />,
    );
    // 名称仅出现在侧边栏底部
    expect(screen.getByText('张三')).toBeInTheDocument();
    // 邮箱同时出现在侧边栏底部和下拉菜单中（共 2 处）
    expect(screen.getAllByText('zhangsan@test.com').length).toBeGreaterThanOrEqual(1);
  });

  // ── Menu items ────────────────────────────────────────────
  it('renders menu items from dynamicMenus prop', () => {
    const menus = [
      { id: 'dash', title: '仪表盘', url: '/dashboard', icon: 'LayoutDashboard' },
      { id: 'users', title: '用户管理', url: '/users', icon: 'Users' },
    ];
    render(<AppSidebar user={{ user: { name: 'Admin' } }} dynamicMenus={menus} />);
    expect(screen.getByText('仪表盘')).toBeInTheDocument();
    expect(screen.getByText('用户管理')).toBeInTheDocument();
  });

  // ── Fallback menus ────────────────────────────────────────
  it('shows fallback menus when dynamicMenus is empty', () => {
    render(<AppSidebar user={{ user: { name: 'Admin' } }} dynamicMenus={[]} />);
    expect(screen.getByText('工作台')).toBeInTheDocument();
    expect(screen.getByText('权限配置')).toBeInTheDocument();
    expect(screen.getByText('安全审计')).toBeInTheDocument();
  });

  it('shows fallback menus when dynamicMenus is undefined', () => {
    render(<AppSidebar user={{ user: { name: 'Admin' } }} />);
    expect(screen.getByText('工作台')).toBeInTheDocument();
    expect(screen.getByText('应用管理')).toBeInTheDocument();
  });

  // ── Sub-menus (children) ──────────────────────────────────
  it('renders sub-menu children items', () => {
    // 设置 pathname 匹配父菜单 URL，使折叠面板展开
    mockUsePathname.mockReturnValue('/settings');
    const menus = [
      {
        id: 'settings',
        title: '系统设置',
        url: '/settings',
        icon: 'Settings',
        children: [
          { id: 'profile', title: '个人资料', url: '/settings/profile' },
          { id: 'security', title: '安全设置', url: '/settings/security' },
        ],
      },
    ];
    render(<AppSidebar user={{ user: { name: 'Admin' } }} dynamicMenus={menus} />);
    // "系统设置"同时出现在侧边栏菜单和下拉菜单中
    expect(screen.getAllByText('系统设置').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('个人资料')).toBeInTheDocument();
    expect(screen.getByText('安全设置')).toBeInTheDocument();
  });

  // ── Empty user → fallback avatar ──────────────────────────
  it('shows fallback avatar "U" when user name is empty', () => {
    render(<AppSidebar user={{ user: {} }} />);
    expect(screen.getByText('U')).toBeInTheDocument();
  });

  it('shows fallback avatar "U" when user is empty object', () => {
    render(<AppSidebar user={{} as any} />);
    expect(screen.getByText('U')).toBeInTheDocument();
  });

  // ── Dropdown menu items ───────────────────────────────────
  it('renders user dropdown with profile, settings and logout', () => {
    render(
      <AppSidebar
        user={{ user: { name: 'Admin', email: 'admin@test.com' } }}
        dynamicMenus={[]}
      />,
    );
    expect(screen.getByText('个人中心')).toBeInTheDocument();
    expect(screen.getByText('系统设置')).toBeInTheDocument();
    expect(screen.getByText('Sign Out')).toBeInTheDocument();
  });

  // ── Brand logo ────────────────────────────────────────────
  it('renders brand logo text', () => {
    render(<AppSidebar user={{ user: { name: 'Admin' } }} />);
    expect(screen.getByText('Auth-SSO')).toBeInTheDocument();
    expect(screen.getByText('Identity OS')).toBeInTheDocument();
  });

  // ── Search input ──────────────────────────────────────────
  it('renders search input placeholder', () => {
    render(<AppSidebar user={{ user: { name: 'Admin' } }} />);
    expect(screen.getByPlaceholderText('搜索功能...')).toBeInTheDocument();
  });
});
