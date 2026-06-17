/**
 * 审计日志页面
 * 展示登录日志和操作日志
 */
'use client';

import { useState, useEffect, useCallback } from 'react';

interface LoginLog {
  id: string;
  userId: string;
  username: string;
  eventType: string;
  ip: string;
  userAgent: string;
  location: string;
  failReason: string;
  createdAt: string;
}

interface AuditLog {
  id: string;
  userId: string;
  username: string;
  operation: string;
  method: string;
  url: string;
  params: string;
  ip: string;
  userAgent: string;
  status: number;
  duration: number;
  errorMsg: string;
  createdAt: string;
}

type TabType = 'login' | 'operation';

const eventTypeLabels: Record<string, string> = {
  LOGIN_SUCCESS: '登录成功',
  LOGIN_FAILED: '登录失败',
  LOGOUT: '登出',
  TOKEN_REFRESH: 'Token刷新',
  TOKEN_REFRESH_FAILED: 'Token刷新失败',
};

const operationLabels: Record<string, string> = {
  USER_CREATE: '创建用户',
  USER_UPDATE: '更新用户',
  USER_DELETE: '删除用户',
  USER_ROLE_ASSIGN: '分配角色',
  ROLE_CREATE: '创建角色',
  ROLE_UPDATE: '更新角色',
  ROLE_DELETE: '删除角色',
  ROLE_PERMISSION_ASSIGN: '分配权限',
  PERMISSION_CREATE: '创建权限',
  PERMISSION_UPDATE: '更新权限',
  PERMISSION_DELETE: '删除权限',
  DEPARTMENT_CREATE: '创建部门',
  DEPARTMENT_UPDATE: '更新部门',
  DEPARTMENT_DELETE: '删除部门',
  CLIENT_CREATE: '创建Client',
  CLIENT_UPDATE: '更新Client',
  CLIENT_DELETE: '删除Client',
  CLIENT_SECRET_REGENERATE: '重置Secret',
  TOKEN_REVOKE: '撤销Token',
};

const eventTypeColors: Record<string, string> = {
  LOGIN_SUCCESS: 'bg-green-100 text-green-800',
  LOGIN_FAILED: 'bg-red-100 text-red-800',
  LOGOUT: 'bg-gray-100 text-gray-800',
  TOKEN_REFRESH: 'bg-blue-100 text-blue-800',
  TOKEN_REFRESH_FAILED: 'bg-orange-100 text-orange-800',
};

export default function AuditLogsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('login');
  const [loginLogs, setLoginLogs] = useState<LoginLog[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchLoginLogs = useCallback(async (pageNum: number) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/audit/login-logs?page=${pageNum}&pageSize=20`);
      if (response.ok) {
        const result = await response.json();
        setLoginLogs(result.data);
        setTotalPages(result.pagination.totalPages);
      }
    } catch (error) {
      console.error('Failed to fetch login logs:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAuditLogs = useCallback(async (pageNum: number) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/audit/logs?page=${pageNum}&pageSize=20`);
      if (response.ok) {
        const result = await response.json();
        setAuditLogs(result.data);
        setTotalPages(result.pagination.totalPages);
      }
    } catch (error) {
      console.error('Failed to fetch audit logs:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(1);
    if (activeTab === 'login') {
      fetchLoginLogs(1);
    } else {
      fetchAuditLogs(1);
    }
  }, [activeTab, fetchLoginLogs, fetchAuditLogs]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    if (activeTab === 'login') {
      fetchLoginLogs(newPage);
    } else {
      fetchAuditLogs(newPage);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">审计日志</h1>
      </div>

      {/* Tab 切换 */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('login')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'login'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            登录日志
          </button>
          <button
            onClick={() => setActiveTab('operation')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'operation'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            操作日志
          </button>
        </nav>
      </div>

      {/* 日志列表 */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">加载中...</div>
      ) : activeTab === 'login' ? (
        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  时间
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  用户
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  事件类型
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  IP 地址
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  失败原因
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loginLogs.map((log) => (
                <tr key={log.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatDate(log.createdAt)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {log.username}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs rounded-full ${eventTypeColors[log.eventType] || 'bg-gray-100 text-gray-800'}`}>
                      {eventTypeLabels[log.eventType] || log.eventType}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {log.ip || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600">
                    {log.failReason || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {loginLogs.length === 0 && (
            <div className="text-center py-12 text-gray-500">暂无登录日志</div>
          )}
        </div>
      ) : (
        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  时间
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作人
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作类型
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  详情
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  状态
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  IP
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatDate(log.createdAt)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {log.username || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">
                      {operationLabels[log.operation] || log.operation}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                    {log.url || log.params || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`text-sm ${log.status === 200 ? 'text-green-600' : 'text-red-600'}`}>
                      {log.status || '-'}
                    </span>
                    {log.errorMsg && (
                      <span className="ml-2 text-xs text-red-500">({log.errorMsg})</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {log.ip || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {auditLogs.length === 0 && (
            <div className="text-center py-12 text-gray-500">暂无操作日志</div>
          )}
        </div>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex justify-center space-x-2">
          <button
            onClick={() => handlePageChange(page - 1)}
            disabled={page === 1}
            className="px-4 py-2 border rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            上一页
          </button>
          <span className="px-4 py-2">
            第 {page} / {totalPages} 页
          </span>
          <button
            onClick={() => handlePageChange(page + 1)}
            disabled={page === totalPages}
            className="px-4 py-2 border rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}