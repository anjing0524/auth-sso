/**
 * Client 详情/编辑页面
 * 查看 Client 详细信息并提供编辑功能
 */
'use client';

import { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Client 数据类型
 */
interface Client {
  id: string;
  publicId: string;
  name: string;
  clientId: string;
  redirectUris: string[];
  grantTypes: string[];
  scopes: string;
  homepageUrl: string | null;
  logoUrl: string | null;
  accessTokenTtl: number;
  refreshTokenTtl: number;
  status: 'ACTIVE' | 'DISABLED';
  disabled: boolean;
  skipConsent: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Token 数据类型
 */
interface Token {
  id: string;
  userId: string;
  username: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
}

/**
 * 格式化日期
 */
function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString('zh-CN');
}

/**
 * 格式化秒数为可读时间
 */
function formatTTL(seconds: number): string {
  if (seconds >= 86400) {
    return `${Math.floor(seconds / 86400)} 天`;
  } else if (seconds >= 3600) {
    return `${Math.floor(seconds / 3600)} 小时`;
  } else if (seconds >= 60) {
    return `${Math.floor(seconds / 60)} 分钟`;
  }
  return `${seconds} 秒`;
}

/**
 * Client 详情页面组件
 */
export default function ClientDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const [client, setClient] = useState<Client | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'info' | 'tokens'>('info');

  // 编辑表单状态
  const [formData, setFormData] = useState({
    name: '',
    redirectUris: '',
    scopes: '',
    homepageUrl: '',
    logoUrl: '',
    accessTokenTtl: 3600,
    refreshTokenTtl: 604800,
    skipConsent: false,
  });

  /**
   * 获取 Client 详情
   */
  const fetchClient = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/clients/${id}`);
      if (response.ok) {
        const data = await response.json();
        setClient(data.data);
        setFormData({
          name: data.data.name,
          redirectUris: data.data.redirectUris.join('\n'),
          scopes: data.data.scopes,
          homepageUrl: data.data.homepageUrl || '',
          logoUrl: data.data.logoUrl || '',
          accessTokenTtl: data.data.accessTokenTtl,
          refreshTokenTtl: data.data.refreshTokenTtl,
          skipConsent: data.data.skipConsent,
        });
      }
    } catch (error) {
      console.error('Failed to fetch client:', error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  /**
   * 获取 Token 列表
   */
  const fetchTokens = useCallback(async () => {
    try {
      const response = await fetch(`/api/clients/${id}/tokens?pageSize=10`);
      if (response.ok) {
        const data = await response.json();
        setTokens(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch tokens:', error);
    }
  }, [id]);

  useEffect(() => {
    fetchClient();
    fetchTokens();
  }, [fetchClient, fetchTokens]);

  /**
   * 保存修改
   */
  const handleSave = async () => {
    if (!client) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          redirectUris: formData.redirectUris.split('\n').filter(Boolean),
          scopes: formData.scopes,
          homepageUrl: formData.homepageUrl || null,
          logoUrl: formData.logoUrl || null,
          accessTokenTtl: formData.accessTokenTtl,
          refreshTokenTtl: formData.refreshTokenTtl,
          skipConsent: formData.skipConsent,
        }),
      });

      if (response.ok) {
        fetchClient();
        alert('保存成功');
      }
    } catch (error) {
      console.error('Failed to save:', error);
      alert('保存失败');
    } finally {
      setSaving(false);
    }
  };

  /**
   * 重新生成 Secret
   */
  const handleRegenerateSecret = async () => {
    if (!confirm('确定要重新生成 Secret 吗？旧的 Secret 将立即失效。')) return;

    try {
      const response = await fetch(`/api/clients/${id}/secret`, {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        setNewSecret(data.data.clientSecret);
      }
    } catch (error) {
      console.error('Failed to regenerate secret:', error);
      alert('重新生成 Secret 失败');
    }
  };

  /**
   * 撤销所有 Token
   */
  const handleRevokeAllTokens = async () => {
    if (!confirm('确定要撤销所有授权 Token 吗？')) return;

    try {
      const response = await fetch(`/api/clients/${id}/tokens`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revokeAll: true }),
      });

      if (response.ok) {
        fetchTokens();
        alert('已撤销所有 Token');
      }
    } catch (error) {
      console.error('Failed to revoke tokens:', error);
    }
  };

  /**
   * 禁用/启用 Client
   */
  const handleToggleStatus = async () => {
    if (!client) return;
    const newStatus = client.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';

    try {
      const response = await fetch(`/api/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        fetchClient();
      }
    } catch (error) {
      console.error('Failed to toggle status:', error);
    }
  };

  /**
   * 复制到剪贴板
   */
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert('已复制到剪贴板');
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      alert('已复制到剪贴板');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Client 不存在</p>
        <Link href="/clients" className="mt-4 text-blue-600 hover:underline">
          返回列表
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link href="/clients" className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{client.name}</h2>
            <p className="text-sm text-gray-500">{client.publicId}</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={handleToggleStatus}
            className={`px-4 py-2 rounded-md text-sm font-medium ${
              client.status === 'ACTIVE'
                ? 'bg-red-50 text-red-600 hover:bg-red-100'
                : 'bg-green-50 text-green-600 hover:bg-green-100'
            }`}
          >
            {client.status === 'ACTIVE' ? '禁用' : '启用'}
          </button>
        </div>
      </div>

      {/* 标签页 */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('info')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'info'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            基本信息
          </button>
          <button
            onClick={() => setActiveTab('tokens')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'tokens'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            授权记录
          </button>
        </nav>
      </div>

      {/* 基本信息 Tab */}
      {activeTab === 'info' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 左侧：编辑表单 */}
          <div className="bg-white shadow rounded-lg">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">编辑信息</h3>
            </div>
            <div className="p-6 space-y-6">
              {/* 名称 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">名称</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* 回调地址 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">回调地址（每行一个）</label>
                <textarea
                  rows={3}
                  value={formData.redirectUris}
                  onChange={(e) => setFormData({ ...formData, redirectUris: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  placeholder="http://localhost:3000/callback"
                />
              </div>

              {/* Scopes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Scopes（空格分隔）</label>
                <input
                  type="text"
                  value={formData.scopes}
                  onChange={(e) => setFormData({ ...formData, scopes: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  placeholder="openid profile email"
                />
              </div>

              {/* 主页 URL */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">主页 URL</label>
                <input
                  type="url"
                  value={formData.homepageUrl}
                  onChange={(e) => setFormData({ ...formData, homepageUrl: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  placeholder="https://example.com"
                />
              </div>

              {/* Token TTL */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Access Token 有效期（秒）</label>
                  <input
                    type="number"
                    value={formData.accessTokenTtl}
                    onChange={(e) => setFormData({ ...formData, accessTokenTtl: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">{formatTTL(formData.accessTokenTtl)}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Refresh Token 有效期（秒）</label>
                  <input
                    type="number"
                    value={formData.refreshTokenTtl}
                    onChange={(e) => setFormData({ ...formData, refreshTokenTtl: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">{formatTTL(formData.refreshTokenTtl)}</p>
                </div>
              </div>

              {/* 跳过授权确认 */}
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="skipConsent"
                  checked={formData.skipConsent}
                  onChange={(e) => setFormData({ ...formData, skipConsent: e.target.checked })}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="skipConsent" className="ml-2 text-sm text-gray-700">
                  跳过授权确认（受信任的客户端）
                </label>
              </div>

              {/* 保存按钮 */}
              <div className="flex justify-end">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? '保存中...' : '保存修改'}
                </button>
              </div>
            </div>
          </div>

          {/* 右侧：凭证信息 */}
          <div className="space-y-6">
            {/* Client ID */}
            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Client ID</h3>
              <div className="flex items-center space-x-2">
                <code className="flex-1 px-3 py-2 bg-gray-100 rounded text-sm font-mono">
                  {client.clientId}
                </code>
                <button
                  onClick={() => copyToClipboard(client.clientId)}
                  className="px-3 py-2 text-gray-400 hover:text-gray-600"
                  title="复制"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Client Secret */}
            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Client Secret</h3>
              {newSecret ? (
                <div className="space-y-3">
                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                    <p className="text-sm text-yellow-800 font-medium">
                      ⚠️ 新 Secret 已生成，请立即保存！此 Secret 仅显示一次。
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <code className="flex-1 px-3 py-2 bg-gray-100 rounded text-sm font-mono break-all">
                      {newSecret}
                    </code>
                    <button
                      onClick={() => copyToClipboard(newSecret)}
                      className="px-3 py-2 text-gray-400 hover:text-gray-600"
                      title="复制"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-500">
                  <p>Secret 已设置，出于安全原因无法查看。</p>
                  <button
                    onClick={handleRegenerateSecret}
                    className="mt-3 text-blue-600 hover:text-blue-700 font-medium"
                  >
                    重新生成 Secret
                  </button>
                </div>
              )}
            </div>

            {/* 创建信息 */}
            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-sm font-medium text-gray-500 mb-4">其他信息</h3>
              <dl className="space-y-3">
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500">状态</dt>
                  <dd>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      client.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                      {client.status === 'ACTIVE' ? '已启用' : '已禁用'}
                    </span>
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500">创建时间</dt>
                  <dd className="text-sm text-gray-900">{formatDate(client.createdAt)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500">更新时间</dt>
                  <dd className="text-sm text-gray-900">{formatDate(client.updatedAt)}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      )}

      {/* 授权记录 Tab */}
      {activeTab === 'tokens' && (
        <div className="bg-white shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">授权 Token 列表</h3>
            <button
              onClick={handleRevokeAllTokens}
              className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md"
            >
              撤销所有
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    用户
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Scopes
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    创建时间
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    过期时间
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {tokens.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                      暂无授权记录
                    </td>
                  </tr>
                ) : (
                  tokens.map((token) => (
                    <tr key={token.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {token.username}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {token.scopes.join(', ')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(token.createdAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(token.expiresAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}