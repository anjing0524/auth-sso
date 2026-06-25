/**
 * 审计日志页面 - Server Component 读模型入口
 *
 * 鉴权由 layout.tsx 统一处理（requirePermission(['audit:read'])），本组件零鉴权样板。
 * Tab 切换与分页均通过 searchParams 驱动（<Link> 渐进增强，无需 'use client'），
 * 直调 app/audit/data.ts 读模型，消除原先 client → /api/audit/* → data.ts 的双重跳转。
 *
 * v2 — shadcn Table + 设计 Token + 暗黑模式支持
 */
import { ShieldAlert, FileText } from 'lucide-react';
import Link from 'next/link';
import { LOGIN_EVENT_LABELS, AUDIT_OPERATION_LABELS } from '@auth-sso/contracts';
import { getLoginLogs, getAuditLogs } from '@/app/audit/data';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/empty-state';

const PAGE_SIZE = 20;

/** 登录事件 -> 徽章配色（支持暗黑模式） */
const EVENT_TYPE_COLORS: Record<string, string> = {
  LOGIN_SUCCESS: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  LOGIN_FAILED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  LOGOUT: 'bg-muted text-muted-foreground',
  TOKEN_REFRESH: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  TOKEN_REFRESH_FAILED: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
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
        ? 'border-primary text-primary'
        : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
    }`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between px-1">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <ShieldAlert className="h-8 w-8 text-primary" /> 审计日志
          </h1>
          <p className="text-muted-foreground text-sm">追踪系统登录记录与管理员操作行为。</p>
        </div>
      </div>

      {/* Tab 切换 — searchParams 驱动 */}
      <div className="border-b border-border">
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
        <Card className="border-none shadow-sm ring-1 ring-border/50 overflow-hidden rounded-xl">
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>用户</TableHead>
                  <TableHead>事件类型</TableHead>
                  <TableHead>IP 地址</TableHead>
                  <TableHead>失败原因</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="p-0">
                      <EmptyState variant="simple" icon={FileText} title="暂无日志记录" description="当前没有登录日志" />
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((log) => {
                    const loginLog = log as { id: string; createdAt: Date | string; username: string; eventType: string; ip: string | null; failReason: string | null };
                    return (
                      <TableRow key={loginLog.id}>
                        <TableCell className="text-foreground">
                          {formatDate(loginLog.createdAt)}
                        </TableCell>
                        <TableCell className="text-foreground">
                          {loginLog.username}
                        </TableCell>
                        <TableCell>
                          <span className={`px-2 py-1 text-xs rounded-full ${EVENT_TYPE_COLORS[loginLog.eventType] || 'bg-muted text-muted-foreground'}`}>
                            {LOGIN_EVENT_LABELS[loginLog.eventType as keyof typeof LOGIN_EVENT_LABELS] || loginLog.eventType}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {loginLog.ip || '-'}
                        </TableCell>
                        <TableCell className="text-destructive">
                          {loginLog.failReason || '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-none shadow-sm ring-1 ring-border/50 overflow-hidden rounded-xl">
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>操作人</TableHead>
                  <TableHead>操作类型</TableHead>
                  <TableHead>详情</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="p-0">
                      <EmptyState variant="simple" icon={FileText} title="暂无日志记录" description="当前没有操作日志" />
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((log) => {
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
                      <TableRow key={opLog.id}>
                        <TableCell className="text-foreground">
                          {formatDate(opLog.createdAt)}
                        </TableCell>
                        <TableCell className="text-foreground">
                          {opLog.username || '-'}
                        </TableCell>
                        <TableCell>
                          <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                            {AUDIT_OPERATION_LABELS[opLog.operation as keyof typeof AUDIT_OPERATION_LABELS] || opLog.operation}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-xs truncate">
                          {opLog.url || (opLog.params ? JSON.stringify(opLog.params) : '') || '-'}
                        </TableCell>
                        <TableCell>
                          <span className={`text-sm ${opLog.status === 200 ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
                            {opLog.status || '-'}
                          </span>
                          {opLog.errorMsg && (
                            <span className="ml-2 text-xs text-destructive">({opLog.errorMsg})</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {opLog.ip || '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* 分页 — searchParams 驱动 */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">共 {pagination.total} 条</span>
          <div className="flex items-center gap-2">
            <Link
              href={pageHref(tab, page - 1)}
              aria-disabled={page === 1}
              className={`px-3 py-1.5 text-sm border border-border rounded-lg transition-colors ${
                page === 1
                  ? 'opacity-50 cursor-not-allowed pointer-events-none text-muted-foreground'
                  : 'text-foreground hover:bg-muted/50'
              }`}
            >
              上一页
            </Link>
            <span className="text-sm text-muted-foreground">
              第 {page} / {pagination.totalPages} 页
            </span>
            <Link
              href={pageHref(tab, page + 1)}
              aria-disabled={page === pagination.totalPages}
              className={`px-3 py-1.5 text-sm border border-border rounded-lg transition-colors ${
                page === pagination.totalPages
                  ? 'opacity-50 cursor-not-allowed pointer-events-none text-muted-foreground'
                  : 'text-foreground hover:bg-muted/50'
              }`}
            >
              下一页
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
