/**
 * Dashboard 概览页面
 * 展示系统核心统计数据和最近活动
 */
'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface Stats {
  users: number;
  roles: number;
  clients: number;
  departments: number;
}

interface AuditLog {
  id: string;
  username: string;
  operation: string;
  createdAt: string;
  status: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({ users: 0, roles: 0, clients: 0, departments: 0 });
  const [recentLogs, setRecentLogs] = useState<AuditLog[]>([]);
  const [userInfo, setUserInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboardData = async () => {
      setLoading(true);
      try {
        // 并行获取各项数据
        const [usersRes, rolesRes, clientsRes, deptsRes, logsRes, meRes] = await Promise.all([
          fetch('/api/users?pageSize=1'),
          fetch('/api/roles?pageSize=1'),
          fetch('/api/clients?pageSize=1'),
          fetch('/api/departments?pageSize=1'),
          fetch('/api/audit/logs?pageSize=5'),
          fetch('/api/me')
        ]);

        const [usersData, rolesData, clientsData, deptsData, logsData, meData] = await Promise.all([
          usersRes.json(),
          rolesRes.json(),
          clientsRes.json(),
          deptsRes.json(),
          logsRes.json(),
          meRes.json()
        ]);

        // 递归计算部门总数
        const countDeptNodes = (nodes: any[]): number => {
          let count = 0;
          nodes.forEach(node => {
            count += 1;
            if (node.children && node.children.length > 0) {
              count += countDeptNodes(node.children);
            }
          });
          return count;
        };

        setStats({
          users: usersData.pagination?.total || (Array.isArray(usersData.data) ? usersData.data.length : 0),
          roles: rolesData.pagination?.total || (Array.isArray(rolesData.data) ? rolesData.data.length : 0),
          clients: clientsData.pagination?.total || (Array.isArray(clientsData.data) ? clientsData.data.length : 0),
          departments: deptsData.pagination?.total || (Array.isArray(deptsData.data) ? countDeptNodes(deptsData.data) : 0),
        });

        setRecentLogs(logsData.data || []);
        setUserInfo(meData.user || null);
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  const statCards = [
    { name: '用户总数', value: stats.users, icon: '👤', color: 'bg-blue-500', href: '/users' },
    { name: '角色数量', value: stats.roles, icon: '🛡️', color: 'bg-purple-500', href: '/roles' },
    { name: '应用 Client', value: stats.clients, icon: '📱', color: 'bg-green-500', href: '/clients' },
    { name: '部门架构', value: stats.departments, icon: '🏢', color: 'bg-orange-500', href: '/departments' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* 欢迎区域 */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">
          欢迎回来，{userInfo?.name || userInfo?.email || '管理员'}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          这是 Auth-SSO 统一身份认证管理门户的实时概览。
        </p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((item) => (
          <Link key={item.name} href={item.href}>
            <div className="bg-white overflow-hidden shadow rounded-lg hover:shadow-md transition-shadow cursor-pointer">
              <div className="p-5">
                <div className="flex items-center">
                  <div className={`flex-shrink-0 rounded-md p-3 ${item.color} text-white text-2xl`}>
                    {item.icon}
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">{item.name}</dt>
                      <dd className="text-2xl font-semibold text-gray-900">{item.value}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* 最近活动 */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <h3 className="text-lg font-medium text-gray-900">最近操作日志</h3>
            <Link href="/audit-logs" className="text-sm text-blue-600 hover:text-blue-500">
              查看全部
            </Link>
          </div>
          <div className="flow-root">
            <ul className="divide-y divide-gray-200">
              {recentLogs.length === 0 ? (
                <li className="px-6 py-12 text-center text-gray-500">暂无活动记录</li>
              ) : (
                recentLogs.map((log) => (
                  <li key={log.id} className="px-6 py-4 hover:bg-gray-50">
                    <div className="flex items-center space-x-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {log.username} 执行了 {log.operation}
                        </p>
                        <p className="text-sm text-gray-500">
                          {new Date(log.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          log.status === 200 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {log.status === 200 ? '成功' : '失败'}
                        </span>
                      </div>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>

        {/* 快速入门 / 系统信息 */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">快捷操作</h3>
          </div>
          <div className="p-6 grid grid-cols-2 gap-4">
            <Link href="/users" className="p-4 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-200 transition-colors group">
              <div className="text-blue-600 mb-2 text-xl group-hover:scale-110 transition-transform">➕</div>
              <div className="font-medium text-gray-900 text-sm">新增用户</div>
              <div className="text-xs text-gray-500">管理系统访问权限</div>
            </Link>
            <Link href="/clients" className="p-4 border border-gray-200 rounded-lg hover:bg-green-50 hover:border-green-200 transition-colors group">
              <div className="text-green-600 mb-2 text-xl group-hover:scale-110 transition-transform">🔌</div>
              <div className="font-medium text-gray-900 text-sm">注册应用</div>
              <div className="text-xs text-gray-500">配置 OAuth2 客户端</div>
            </Link>
            <Link href="/roles" className="p-4 border border-gray-200 rounded-lg hover:bg-purple-50 hover:border-purple-200 transition-colors group">
              <div className="text-purple-600 mb-2 text-xl group-hover:scale-110 transition-transform">🔑</div>
              <div className="font-medium text-gray-900 text-sm">分配角色</div>
              <div className="text-xs text-gray-500">细粒度访问控制</div>
            </Link>
            <Link href="/departments" className="p-4 border border-gray-200 rounded-lg hover:bg-orange-50 hover:border-orange-200 transition-colors group">
              <div className="text-orange-600 mb-2 text-xl group-hover:scale-110 transition-transform">🌳</div>
              <div className="font-medium text-gray-900 text-sm">维护部门</div>
              <div className="text-xs text-gray-500">组织架构同步</div>
            </Link>
          </div>
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
            <div className="flex items-center text-xs text-gray-500">
              <span className="flex-shrink-0 h-2 w-2 rounded-full bg-green-400 mr-2"></span>
              系统运行状态良好，所有服务正常在线。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
