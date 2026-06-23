/**
 * Client 基本信息 Section — 编辑表单 + 凭证信息
 *
 * 从 `clients/[id]/page.tsx` 提取，接收 props 实现纯展示 + 回调委托。
 */
'use client';

import type { ClientDTO as Client } from '../../data';

export interface ClientInfoSectionProps {
  client: Client;
  formData: {
    name: string;
    redirectUris: string;
    scopes: string;
    homepageUrl: string;
    logoUrl: string;
    accessTokenTtl: number;
    refreshTokenTtl: number;
  };
  saving: boolean;
  newSecret: string | null;
  onFormChange: (data: Partial<ClientInfoSectionProps['formData']>) => void;
  onSave: () => Promise<void>;
  onRegenerateSecret: () => Promise<void>;
  onToggleStatus: () => Promise<void>;
  onCopy: (text: string) => Promise<void>;
}

/** 格式化秒数为可读时间 */
function formatTTL(seconds: number): string {
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)} 天`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} 小时`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)} 分钟`;
  return `${seconds} 秒`;
}

/** 格式化日期 */
function formatDate(date: Date | string | null): string {
  if (!date) return '-';
  return new Date(date).toLocaleString('zh-CN');
}

export function ClientInfoSection({
  client,
  formData,
  saving,
  newSecret,
  onFormChange,
  onSave,
  onRegenerateSecret,
  onToggleStatus,
  onCopy,
}: ClientInfoSectionProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 左侧：编辑表单 */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">编辑信息</h3>
        </div>
        <div className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">名称</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => onFormChange({ name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">回调地址（每行一个）</label>
            <textarea
              rows={3}
              value={formData.redirectUris}
              onChange={(e) => onFormChange({ redirectUris: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="https://your-app.example.com/callback"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Scopes（空格分隔）</label>
            <input
              type="text"
              value={formData.scopes}
              onChange={(e) => onFormChange({ scopes: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="openid profile email"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">主页 URL</label>
            <input
              type="url"
              value={formData.homepageUrl}
              onChange={(e) => onFormChange({ homepageUrl: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="https://example.com"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Access Token 有效期（秒）</label>
              <input
                type="number"
                value={formData.accessTokenTtl}
                onChange={(e) => onFormChange({ accessTokenTtl: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">{formatTTL(formData.accessTokenTtl)}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Refresh Token 有效期（秒）</label>
              <input
                type="number"
                value={formData.refreshTokenTtl}
                onChange={(e) => onFormChange({ refreshTokenTtl: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">{formatTTL(formData.refreshTokenTtl)}</p>
            </div>
          </div>

          <div className="flex justify-between items-center">
            <button
              onClick={onToggleStatus}
              className={`px-4 py-2 rounded-md text-sm font-medium ${
                client.status === 'ACTIVE'
                  ? 'bg-red-50 text-red-600 hover:bg-red-100'
                  : 'bg-green-50 text-green-600 hover:bg-green-100'
              }`}
            >
              {client.status === 'ACTIVE' ? '禁用' : '启用'}
            </button>
            <button
              onClick={onSave}
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
              onClick={() => onCopy(client.clientId)}
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
                  onClick={() => onCopy(newSecret)}
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
                onClick={onRegenerateSecret}
                className="mt-3 text-blue-600 hover:text-blue-700 font-medium"
              >
                重新生成 Secret
              </button>
            </div>
          )}
        </div>

        {/* 其他信息 */}
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
  );
}
