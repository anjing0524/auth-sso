/**
 * AppSidebar 侧边栏组件测试
 *
 * @req A-NAV-01
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
 * - 正常：登录用户下拉菜单渲染个人中心/登出（「系统设置」曾与个人中心同指向 /profile，已删重复项）
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { AppSidebar } from '@/components/layout/app-sidebar';
import type * as sidebarModule from '@/components/ui/sidebar';
import type * as dropdownMenuModule from '@/components/ui/dropdown-menu';


// ============================================================
// Mocks
// ============================================================
const mockUsePathname = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: (...args: unknown[]) => mockUsePathname(...args),
}));

// 为了绕过 vite hoist 上下文限制，在 vi.mock 外部定义工厂函数
// 通过 `require('react')` 获取 React.createElement

function makeSidebarMock(): { [K in keyof typeof sidebarModule]?: (props: any) => unknown } {
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

function makeDropdownMock(): { [K in keyof typeof dropdownMenuModule]?: (props: any) => unknown } {
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

/**
 * 把"最小 stub 组件"约束为目标模块的键集后一次性断言其值类型。
 *
 * 键集受 `keyof T` 约束——但**只对对象字面量实参成立**（多余属性检查不适用于函数调用结果），
 * 故两个工厂的返回类型各自显式写成映射类型，键集在那里被当场抓住；值类型必须断言，因为真实
 * 组件是 `forwardRef` 组件类型（带 `$$typeof` 等内部字段），jsdom 下的普通函数 stub
 * 在结构上不可能满足它。
 */
function asComponentStubs<T>(stubs: { [K in keyof T]?: (props: any) => unknown }): Partial<T> {
  return stubs as Partial<T>;
}
// 注：必须用**函数声明**——`vi.mock` 工厂会被提升到文件顶部，`const` 箭头函数在工厂执行时仍在 TDZ

// 将工厂函数包装为匿名函数传递给 vi.mock
// `require('react')` 在这些函数首次调用时才执行，此时模块系统已就绪
vi.mock('next/link', () => makeLinkMock());
// @allow-module-mock @/components/ui/sidebar full-replacement: UI 原语 stub：真实组件是 forwardRef 组件，本文件测的是导航逻辑
vi.mock(import('@/components/ui/sidebar'), (): Partial<typeof sidebarModule> =>
  asComponentStubs<typeof sidebarModule>(makeSidebarMock()));
// @allow-module-mock @/components/ui/dropdown-menu full-replacement: UI 原语 stub，同上
vi.mock(import('@/components/ui/dropdown-menu'), (): Partial<typeof dropdownMenuModule> =>
  asComponentStubs<typeof dropdownMenuModule>(makeDropdownMock()));

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
        user={{ name: '张三', email: 'zhangsan@test.com' }}
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
    render(<AppSidebar user={{ name: 'Admin' }} dynamicMenus={menus} />);
    expect(screen.getByText('仪表盘')).toBeInTheDocument();
    expect(screen.getByText('用户管理')).toBeInTheDocument();
  });

  // ── Fallback menus ────────────────────────────────────────
  it('无动态菜单时不回退全量内置菜单（权限越少不能看到越多入口）', () => {
    render(<AppSidebar user={{ name: 'Admin' }} dynamicMenus={[]} />);
    expect(screen.queryByText('工作台')).not.toBeInTheDocument();
    expect(screen.queryByText('权限中心')).not.toBeInTheDocument();
    expect(screen.queryByText('安全审计')).not.toBeInTheDocument();
  });

  it('dynamicMenus 未传时同样不展示内置菜单', () => {
    render(<AppSidebar user={{ name: 'Admin' }} />);
    expect(screen.queryByText('工作台')).not.toBeInTheDocument();
    expect(screen.queryByText('应用管理')).not.toBeInTheDocument();
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
          { id: 'profile', title: '个人资料', url: '/settings/profile', icon: '' },
          { id: 'security', title: '安全设置', url: '/settings/security', icon: '' },
        ],
      },
    ];
    render(<AppSidebar user={{ name: 'Admin' }} dynamicMenus={menus} />);
    // "系统设置"同时出现在侧边栏菜单和下拉菜单中
    expect(screen.getAllByText('系统设置').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('个人资料')).toBeInTheDocument();
    expect(screen.getByText('安全设置')).toBeInTheDocument();
  });

  // ── Empty user → fallback avatar ──────────────────────────
  it('shows fallback avatar "U" when user name is empty', () => {
    render(<AppSidebar user={{ }} />);
    expect(screen.getByText('U')).toBeInTheDocument();
  });

  it('shows fallback avatar "U" when user is empty object', () => {
    render(<AppSidebar user={{} as any} />);
    expect(screen.getByText('U')).toBeInTheDocument();
  });

  // ── Dropdown menu items ───────────────────────────────────
  it('renders user dropdown with profile and logout (no duplicate settings entry)', () => {
    render(
      <AppSidebar
        user={{ name: 'Admin', email: 'admin@test.com' }}
        dynamicMenus={[]}
      />,
    );
    expect(screen.getByText('个人中心')).toBeInTheDocument();
    expect(screen.getByText('退出登录')).toBeInTheDocument();
    // 「系统设置」曾与「个人中心」同为 /profile 的重复入口，已删除；此处钉住"不重复"
    expect(screen.queryByText('系统设置')).toBeNull();
  });

  // ── Brand logo ────────────────────────────────────────────
  it('renders brand logo text', () => {
    render(<AppSidebar user={{ name: 'Admin' }} />);
    expect(screen.getByText('Auth-SSO')).toBeInTheDocument();
    expect(screen.getByText('Identity OS')).toBeInTheDocument();
  });

});
