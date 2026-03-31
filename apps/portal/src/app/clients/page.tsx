/**
 * Client 列表页面
 * 展示所有 OAuth Client，支持搜索、筛选和分页
 */
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

/**
 * Client 数据类型
 */
interface Client {
  id: string;
  publicId: string;
  name: string;
  clientId: string;
  redirectUris: string[];
  scopes: string;
  homepageUrl: string | null;
  logoUrl: string | null;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  updatedAt: string;
}

/**
 * 分页信息类型
 */
interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * 复制文本到剪贴板
 */
async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

/**
 * 格式化日期
 */
function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Client 状态徽章
 */
function StatusBadge({ status }: { status: 'ACTIVE' | 'DISABLED' }) {
  return (
    <span
      className={`
        inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
        ${status === 'ACTIVE'
          ? 'bg-green-100 text-green-800'
          : 'bg-gray-100 text-gray-800'
        }
      `}
    >
      {status === 'ACTIVE' ? '已启用' : '已禁用'}
    </span>
  );
}

/**
 * Client 列表页面组件
 */
export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  });
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  /**
   * 获取 Client 列表
   */
  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        pageSize: pagination.pageSize.toString(),
      });
      if (keyword) params.append('keyword', keyword);
      if (statusFilter) params.append('status', statusFilter);

      const response = await fetch(`/api/clients?${params.toString()}`);
      const data = await response.json();

      if (response.ok) {
        setClients(data.data);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('Failed to fetch clients:', error);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, keyword, statusFilter]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  /**
   * 处理搜索
   */
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPagination(prev => ({ ...prev, page: 1 }));
    fetchClients();
  };

  /**
   * 处理复制 Client ID
   */
  const handleCopyId = async (clientId: string, id: string) => {
    await copyToClipboard(clientId);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  /**
   * 处理禁用/启用 Client
   */
  const handleToggleStatus = async (client: Client) => {
    const newStatus = client.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    try {
      const response = await fetch(`/api/clients/${client.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        fetchClients();
      }
    } catch (error) {
      console.error('Failed to toggle status:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* 页面标题和操作按钮 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">OAuth Client 管理</h2>
          <p className="mt-1 text-sm text-gray-500">
            管理所有 OAuth 应用客户端，配置授权参数
          </p>
        </div>
        <Link
          href="/clients/new"
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          新建 Client
        </Link>
      </div>

      {/* 搜索和筛选 */}
      <div className="bg-white shadow rounded-lg">
        <form onSubmit={handleSearch} className="p-4 sm:p-6 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label htmlFor="keyword" className="sr-only">搜索</label>
              <input
                type="text"
                id="keyword"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索名称或 Client ID..."
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div className="sm:w-48">
              <label htmlFor="status" className="sr-only">状态</label>
              <select
                id="status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">全部状态</option>
                <option value="ACTIVE">已启用</option>
                <option value="DISABLED">已禁用</option>
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

        {/* Client 列表表格 */}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  名称
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Client ID
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  回调地址
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  状态
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  创建时间
                </th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    加载中...
                  </td>
                </tr>
              ) : clients.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    暂无数据
                  </td>
                </tr>
              ) : (
                clients.map((client) => (
                  <tr key={client.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        {client.logoUrl ? (
                          <img src={client.logoUrl} alt="" className="w-8 h-8 rounded mr-3" />
                        ) : (
                          <div className="w-8 h-8 rounded bg-blue-100 flex items-center justify-center mr-3">
                            <span className="text-blue-600 font-medium text-sm">
                              {client.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                        )}
                        <div>
                          <div className="text-sm font-medium text-gray-900">{client.name}</div>
                          {client.homepageUrl && (
                            <a href={client.homepageUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                              {client.homepageUrl}
                            </a>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center space-x-2">
                        <code className="text-sm text-gray-600 bg-gray-100 px-2 py-1 rounded">
                          {client.clientId}
                        </code>
                        <button
                          onClick={() => handleCopyId(client.clientId, client.id)}
                          className="text-gray-400 hover:text-gray-600"
                          title="复制"
                        >
                          {copiedId === client.id ? (
                            <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="max-w-xs truncate text-sm text-gray-500">
                        {client.redirectUris.map((uri, i) => (
                          <span key={i}>
                            {uri}
                            {i < client.redirectUris.length - 1 && ', '}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <StatusBadge status={client.status} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(client.createdAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                      <Link
                        href={`/clients/${client.id}`}
                        className="text-blue-600 hover:text-blue-900"
                      >
                        编辑
                      </Link>
                      <button
                        onClick={() => handleToggleStatus(client)}
                        className={`text-${client.status === 'ACTIVE' ? 'red' : 'green'}-600 hover:text-${client.status === 'ACTIVE' ? 'red' : 'green'}-900`}
                      >
                        {client.status === 'ACTIVE' ? '禁用' : '启用'}
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
            <div className="text-sm text-gray-500">
              共 {pagination.total} 条记录
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                disabled={pagination.page === 1}
                className="px-3 py-1 rounded border border-gray-300 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                上一页
              </button>
              <span className="px-3 py-1 text-sm text-gray-600">
                {pagination.page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                disabled={pagination.page === pagination.totalPages}
                className="px-3 py-1 rounded border border-gray-300 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
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