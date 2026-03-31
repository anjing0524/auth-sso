/**
 * Dashboard 布局组件
 * 提供统一的侧边栏导航和页面结构
 * 根据用户权限动态过滤菜单项
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useState, useEffect, useCallback } from 'react';

interface DashboardLayoutProps {
  children: ReactNode;
}

/**
 * 用户权限上下文
 */
interface UserPermissionContext {
  roles: Array<{ id: string; code: string; name: string }>;
  permissions: string[];
  dataScopeType: string;
  deptId?: string;
}

/**
 * 导航菜单项配置
 * 每个菜单项关联所需的权限编码
 */
const navItems = [
  {
    name: '概览',
    href: '/dashboard',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
    permissions: [], // 概览页面不需要特定权限
  },
  {
    name: '用户管理',
    href: '/users',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
    permissions: ['user:list', 'user:read'], // 用户管理需要用户列表或读取权限
  },
  {
    name: 'Client 管理',
    href: '/clients',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
      </svg>
    ),
    permissions: ['client:list', 'client:read'], // Client 管理需要列表或读取权限
  },
  {
    name: '角色权限',
    href: '/roles',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
    permissions: ['role:list', 'role:read'], // 角色管理需要列表或读取权限
  },
  {
    name: '部门管理',
    href: '/departments',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
    permissions: ['department:list', 'department:read'], // 部门管理需要列表或读取权限
  },
  {
    name: '审计日志',
    href: '/audit-logs',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    ),
    permissions: ['audit:list', 'audit:read'], // 审计日志需要列表或读取权限
  },
];

/**
 * 检查用户是否有访问菜单项的权限
 * @param userPermissions 用户拥有的权限列表
 * @param requiredPermissions 菜单项要求的权限列表
 * @returns 是否有权限访问
 */
function hasMenuPermission(userPermissions: string[], requiredPermissions: string[]): boolean {
  // 如果菜单项没有权限要求，则所有人都可以访问
  if (requiredPermissions.length === 0) {
    return true;
  }

  // 用户拥有任一要求的权限即可访问
  return requiredPermissions.some(p => userPermissions.includes(p));
}

/**
 * Dashboard 布局组件
 * 提供侧边栏导航、顶部栏和主内容区域
 */
export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  /**
   * 获取用户权限
   */
  const fetchUserPermissions = useCallback(async () => {
    try {
      const response = await fetch('/api/me/permissions');
      if (response.ok) {
        const result = await response.json();
        setUserPermissions(result.data.permissions || []);
      } else {
        // 未登录或权限获取失败，显示基础菜单
        setUserPermissions([]);
      }
    } catch (error) {
      console.error('[DashboardLayout] 获取权限失败:', error);
      setUserPermissions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUserPermissions();
  }, [fetchUserPermissions]);

  // 根据权限过滤菜单项
  const visibleNavItems = navItems.filter(item =>
    hasMenuPermission(userPermissions, item.permissions)
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 侧边栏 - 桌面端 */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col">
        <div className="flex flex-col flex-grow bg-white border-r border-gray-200 pt-5 overflow-y-auto">
          {/* Logo */}
          <div className="flex items-center flex-shrink-0 px-4">
            <span className="text-xl font-bold text-blue-600">Auth-SSO</span>
          </div>

          {/* 导航菜单 */}
          <nav className="mt-8 flex-1 px-2 space-y-1">
            {loading ? (
              // 加载状态
              <div className="px-3 py-2 text-sm text-gray-400">加载菜单...</div>
            ) : (
              visibleNavItems.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`
                      group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors
                      ${isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                      }
                    `}
                  >
                    <span className={`mr-3 ${isActive ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-500'}`}>
                      {item.icon}
                    </span>
                    {item.name}
                  </Link>
                );
              })
            )}
          </nav>

          {/* 底部用户区域 */}
          <div className="flex-shrink-0 flex border-t border-gray-200 p-4">
            <a
              href="/api/auth/logout"
              className="flex items-center text-sm text-gray-500 hover:text-gray-700"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              退出登录
            </a>
          </div>
        </div>
      </aside>

      {/* 移动端侧边栏 */}
      <div className={`lg:hidden fixed inset-0 z-40 ${sidebarOpen ? '' : 'hidden'}`}>
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75" onClick={() => setSidebarOpen(false)} />
        <div className="relative flex-1 flex flex-col max-w-xs w-full bg-white">
          <div className="absolute top-0 right-0 -mr-12 pt-2">
            <button
              type="button"
              className="ml-1 flex items-center justify-center h-10 w-10 rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white"
              onClick={() => setSidebarOpen(false)}
            >
              <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 h-0 pt-5 pb-4 overflow-y-auto">
            <div className="flex-shrink-0 flex items-center px-4">
              <span className="text-xl font-bold text-blue-600">Auth-SSO</span>
            </div>
            <nav className="mt-5 px-2 space-y-1">
              {loading ? (
                <div className="px-3 py-2 text-base text-gray-400">加载菜单...</div>
              ) : (
                visibleNavItems.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      className={`
                        group flex items-center px-3 py-2 text-base font-medium rounded-md
                        ${isActive
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                        }
                      `}
                      onClick={() => setSidebarOpen(false)}
                    >
                      <span className={`mr-4 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}>
                        {item.icon}
                      </span>
                      {item.name}
                    </Link>
                  );
                })
              )}
            </nav>
          </div>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="lg:pl-64 flex flex-col flex-1">
        {/* 顶部栏 */}
        <header className="sticky top-0 z-10 flex-shrink-0 flex h-16 bg-white border-b border-gray-200">
          <button
            type="button"
            className="px-4 border-r border-gray-200 text-gray-500 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex-1 px-4 flex justify-between items-center">
            <h1 className="text-lg font-semibold text-gray-900">
              {visibleNavItems.find(item => pathname === item.href || pathname.startsWith(item.href + '/'))?.name || '管理门户'}
            </h1>
            <div className="flex items-center space-x-4">
              <a
                href="/api/me"
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                用户信息
              </a>
            </div>
          </div>
        </header>

        {/* 页面内容 */}
        <main className="flex-1 relative overflow-y-auto focus:outline-none">
          <div className="py-6 px-4 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}