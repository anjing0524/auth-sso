/**
 * 审计日志页面 - Server Component 读模型入口
 *
 * 鉴权由 layout.tsx 统一处理（requirePermission(['audit:read'])），本组件零鉴权样板。
 * Tab 切换与分页均通过 searchParams 驱动（<Link> 渐进增强，无需 'use client'），
 * 直调 app/audit/data.ts 读模型，消除原先 client → /api/audit/* → data.ts 的双重跳转。
 */
import Link from 'next/link';
import { LOGIN_EVENT_LABELS, AUDIT_OPERATION_LABELS } from '@auth-sso/contracts';
import { getLoginLogs, getAuditLogs } from '@/app/audit/data';

const PAGE_SIZE = 20;

/** 登录事件 → 徽章配色 */
const EVENT_TYPE_COLORS: Record<string, string> = {
  LOGIN_SUCCESS: 'bg-green-100 text-green-800',
  LOGIN_FAILED: 'bg-red-100 text-red-800',
  LOGOUT: 'bg-gray-100 text-gray-800',
  TOKEN_REFRESH: 'bg-blue-100 text-blue-800',
  TOKEN_REFRESH_FAILED: 'bg-orange-100 text-orange-800',
};

interface PageProps {
  searchParams: Promise<{
    tab?: string;
    page?: string;
  }>;
}

/** 格式化日期（兼容 Date 与 ISO 字符串） */
function formatDate(date: Date | string): string {
  return new Date(date).toLocaleString('zh-CN');
}

/** 生成分页链接的 href，保留当前 tab */
function pageHref(tab: string, page: number): string {
  return `/audit-logs?tab=${tab}&page=${page}`;
}

export default async function AuditLogsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const tab: 'login' | 'operation' = params.tab === 'operation' ? 'operation' : 'login';
  const page = Math.max(1, parseInt(params.page || '1', 10) || 1);

  // 按当前 tab 仅查询所需数据源，互斥取数
  const { data, pagination } =
    tab === 'login'
      ? await getLoginLogs({ page, pageSize: PAGE_SIZE })
      : await getAuditLogs({ page, pageSize: PAGE_SIZE });

  const tabButtonClass = (active: boolean) =>
    `py-4 px-1 border-b-2 font-medium text-sm ${
      active
        ? 'border-blue-500 text-blue-600'
        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
    }`;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">审计日志</h1>
      </div>

      {/* Tab 切换 — searchParams 驱动 */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <Link href={pageHref('login', 1)} className={tabButtonClass(tab === 'login')}>
            登录日志
          </Link>
          <Link href={pageHref('operation', 1)} className={tabButtonClass(tab === 'operation')}>
            操作日志
          </Link>
        </nav>
      </div>

      {/* 日志列表 */}
      {tab === 'login' ? (
        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <Th>时间</Th>
                <Th>用户</Th>
                <Th>事件类型</Th>
                <Th>IP 地址</Th>
                <Th>失败原因</Th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {data.map((log) => {
                const loginLog = log as { id: string; createdAt: Date | string; username: string; eventType: string; ip: string | null; failReason: string | null };
                return (
                  <tr key={loginLog.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(loginLog.createdAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {loginLog.username}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs rounded-full ${EVENT_TYPE_COLORS[loginLog.eventType] || 'bg-gray-100 text-gray-800'}`}>
                        {LOGIN_EVENT_LABELS[loginLog.eventType as keyof typeof LOGIN_EVENT_LABELS] || loginLog.eventType}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {loginLog.ip || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600">
                      {loginLog.failReason || '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {data.length === 0 && (
            <div className="text-center py-12 text-gray-500">暂无登录日志</div>
          )}
        </div>
      ) : (
        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <Th>时间</Th>
                <Th>操作人</Th>
                <Th>操作类型</Th>
                <Th>详情</Th>
                <Th>状态</Th>
                <Th>IP</Th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {data.map((log) => {
                const opLog = log as {
                  id: string;
                  createdAt: Date | string;
                  username: string | null;
                  operation: string;
                  url: string | null;
                  params: Record<string, unknown> | null;
                  status: number | null;
                  errorMsg: string | null;
                  ip: string | null;
                };
                return (
                  <tr key={opLog.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(opLog.createdAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {opLog.username || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">
                        {AUDIT_OPERATION_LABELS[opLog.operation as keyof typeof AUDIT_OPERATION_LABELS] || opLog.operation}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                      {opLog.url || (opLog.params ? JSON.stringify(opLog.params) : '') || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`text-sm ${opLog.status === 200 ? 'text-green-600' : 'text-red-600'}`}>
                        {opLog.status || '-'}
                      </span>
                      {opLog.errorMsg && (
                        <span className="ml-2 text-xs text-red-500">({opLog.errorMsg})</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {opLog.ip || '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {data.length === 0 && (
            <div className="text-center py-12 text-gray-500">暂无操作日志</div>
          )}
        </div>
      )}

      {/* 分页 — searchParams 驱动 */}
      {pagination.totalPages > 1 && (
        <div className="flex justify-center space-x-2">
          <Link
            href={pageHref(tab, page - 1)}
            aria-disabled={page === 1}
            className={`px-4 py-2 border rounded-md ${page === 1 ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
          >
            上一页
          </Link>
          <span className="px-4 py-2">
            第 {page} / {pagination.totalPages} 页
          </span>
          <Link
            href={pageHref(tab, page + 1)}
            aria-disabled={page === pagination.totalPages}
            className={`px-4 py-2 border rounded-md ${page === pagination.totalPages ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
          >
            下一页
          </Link>
        </div>
      )}
    </div>
  );
}

/** 表头单元格（提取静态 JSX，复用） */
function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
      {children}
    </th>
  );
}
