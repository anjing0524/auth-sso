/**
 * 用户管理页面
 * 展示用户列表，支持搜索、筛选、分页
 */
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

/**
 * 用户数据类型
 */
interface User {
  id: string;
  publicId: string;
  username: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  status: 'ACTIVE' | 'DISABLED' | 'LOCKED';
  deptId: string | null;
  deptName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

/**
 * 分页信息
 */
interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * 格式化日期
 */
function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 状态徽章
 */
function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    ACTIVE: { bg: 'bg-green-100', text: 'text-green-800', label: '正常' },
    DISABLED: { bg: 'bg-gray-100', text: 'text-gray-800', label: '已禁用' },
    LOCKED: { bg: 'bg-red-100', text: 'text-red-800', label: '已锁定' },
  };
  const { bg, text, label } = config[status] || config.ACTIVE;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${bg} ${text}`}>
      {label}
    </span>
  );
}

/**
 * 用户管理页面组件
 */
export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1, pageSize: 20, total: 0, totalPages: 0,
  });
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  /**
   * 获取用户列表
   */
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        pageSize: pagination.pageSize.toString(),
      });
      if (keyword) params.append('keyword', keyword);
      if (statusFilter) params.append('status', statusFilter);

      const response = await fetch(`/api/users?${params.toString()}`);
      const data = await response.json();

      if (response.ok) {
        setUsers(data.data);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, keyword, statusFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  /**
   * 处理搜索
   */
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPagination(prev => ({ ...prev, page: 1 }));
    fetchUsers();
  };

  /**
   * 切换用户状态
   */
  const handleToggleStatus = async (user: User) => {
    const newStatus = user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        fetchUsers();
      }
    } catch (error) {
      console.error('Failed to toggle status:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">用户管理</h2>
          <p className="mt-1 text-sm text-gray-500">管理系统用户账户和信息</p>
        </div>
      </div>

      {/* 搜索和筛选 */}
      <div className="bg-white shadow rounded-lg">
        <form onSubmit={handleSearch} className="p-4 sm:p-6 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索用户名、邮箱或姓名..."
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div className="sm:w-48">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">全部状态</option>
                <option value="ACTIVE">正常</option>
                <option value="DISABLED">已禁用</option>
                <option value="LOCKED">已锁定</option>
              </select>
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-gray-100 text-gray-700 font-medium rounded-md hover:bg-gray-200"
            >
              搜索
            </button>
          </div>
        </form>

        {/* 用户列表表格 */}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">用户</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">部门</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">创建时间</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">最后登录</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">加载中...</td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">暂无数据</td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center mr-3">
                          <span className="text-blue-600 font-medium">
                            {user.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900">{user.name}</div>
                          <div className="text-sm text-gray-500">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {user.deptName || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <StatusBadge status={user.status} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(user.createdAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(user.lastLoginAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                      <Link href={`/users/${user.id}`} className="text-blue-600 hover:text-blue-900">
                        编辑
                      </Link>
                      <button
                        onClick={() => handleToggleStatus(user)}
                        className={`text-${user.status === 'ACTIVE' ? 'red' : 'green'}-600 hover:text-${user.status === 'ACTIVE' ? 'red' : 'green'}-900`}
                      >
                        {user.status === 'ACTIVE' ? '禁用' : '启用'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        {pagination.totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
            <div className="text-sm text-gray-500">共 {pagination.total} 条记录</div>
            <div className="flex space-x-2">
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                disabled={pagination.page === 1}
                className="px-3 py-1 rounded border border-gray-300 text-sm disabled:opacity-50 hover:bg-gray-50"
              >
                上一页
              </button>
              <span className="px-3 py-1 text-sm text-gray-600">
                {pagination.page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                disabled={pagination.page === pagination.totalPages}
                className="px-3 py-1 rounded border border-gray-300 text-sm disabled:opacity-50 hover:bg-gray-50"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}