/**
 * Client 授权 Token Section — Token 列表 + 撤销操作
 *
 * 从 `clients/[id]/page.tsx` 提取，接收 props 实现纯展示 + 回调委托。
 */
'use client';

import type { ClientTokenDTO as Token } from '../../data';

export interface ClientTokensSectionProps {
  tokens: Token[];
  onRevokeAll: () => Promise<void>;
}

/** 格式化日期 */
function formatDate(date: Date | string | null): string {
  if (!date) return '-';
  return new Date(date).toLocaleString('zh-CN');
}

export function ClientTokensSection({ tokens, onRevokeAll }: ClientTokensSectionProps) {
  return (
    <div className="bg-white shadow rounded-lg">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900">授权 Token 列表</h3>
        <button
          onClick={onRevokeAll}
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
  );
}
