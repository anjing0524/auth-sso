/**
 * 审计日志页面 - Server Component 读模型入口
 *
 * 鉴权由 layout.tsx 统一处理（requirePermission(['audit:read'])），本组件零鉴权样板。
 * Tab 切换与分页均通过 searchParams 驱动（<Link> 渐进增强，无需 'use client'），
 * 直调 app/audit/data.ts 读模型，消除原先 client → /api/audit/* → data.ts 的双重跳转。
 *
 * v2 — shadcn Table + 设计 Token + 暗黑模式支持
 */
import { ShieldAlert, FileText, Download } from 'lucide-react';
import Link from 'next/link';
import {
  LOGIN_EVENT_LABELS,
  LOGIN_EVENT_VALUES,
  AUDIT_OPERATION_LABELS,
  AUDIT_OPERATION_VALUES,
  type AuditOperation,
  type LoginEventType,
} from '@auth-sso/contracts';
import { getLoginLogs, getAuditLogs } from '@/app/audit/data';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/empty-state';
import { formatShanghaiDateTime } from '@/lib/format-time';

const PAGE_SIZE = 20;

/** 登录事件 -> 徽章配色（使用 design token，支持暗黑模式） */
const EVENT_TYPE_COLORS: Record<string, string> = {
  LOGIN_SUCCESS: 'bg-success/10 text-success dark:bg-success/20 dark:text-success',
  LOGIN_FAILED: 'bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive',
  LOGOUT: 'bg-muted text-muted-foreground',
  TOKEN_REFRESH: 'bg-info/10 text-info dark:bg-info/20 dark:text-info',
  TOKEN_REFRESH_FAILED: 'bg-warning/10 text-warning dark:bg-warning/20 dark:text-warning',
};

interface PageProps {
  searchParams: Promise<{
    tab?: string;
    page?: string;
    username?: string;
    operation?: string;
    eventType?: string;
    target?: string;
    startDate?: string;
    endDate?: string;
  }>;
}

/** 生成链接并保留当前筛选条件。 */
function auditHref(
  params: Awaited<PageProps['searchParams']>,
  overrides: Record<string, string | number | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  return `/audit-logs?${query.toString()}`;
}

export default async function AuditLogsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const tab: 'login' | 'operation' = params.tab === 'operation' ? 'operation' : 'login';
  const page = Math.max(1, parseInt(params.page || '1', 10) || 1);
  const rawOperation = params.operation;
  const operation = rawOperation && (AUDIT_OPERATION_VALUES as readonly string[]).includes(rawOperation)
    ? rawOperation as AuditOperation
    : undefined;
  const rawEventType = params.eventType;
  const eventType = rawEventType && (LOGIN_EVENT_VALUES as readonly string[]).includes(rawEventType)
    ? rawEventType as LoginEventType
    : undefined;

  // 按当前 tab 仅查询所需数据源，互斥取数
  const { data, pagination } =
    tab === 'login'
      ? await getLoginLogs({
        page,
        pageSize: PAGE_SIZE,
        username: params.username,
        eventType,
        startDate: params.startDate,
        endDate: params.endDate,
      })
      : await getAuditLogs({
        page,
        pageSize: PAGE_SIZE,
        username: params.username,
        operation,
        target: params.target,
        startDate: params.startDate,
        endDate: params.endDate,
      });
  const exportQuery = new URLSearchParams({
    type: tab === 'login' ? 'login' : 'operation',
  });
  for (const key of ['username', 'operation', 'eventType', 'target', 'startDate', 'endDate'] as const) {
    if (params[key]) exportQuery.set(key, params[key]!);
  }

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
        <div className="flex gap-2">
          <a
            href={`/api/audit/export?${exportQuery.toString()}`}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            <Download className="h-4 w-4" /> 导出当前结果 CSV
          </a>
        </div>
      </div>

      {/* Tab 切换 — searchParams 驱动 */}
      <div className="border-b border-border">
        <nav className="-mb-px flex space-x-8">
          <Link href={auditHref(params, { tab: 'login', page: 1, operation: undefined, target: undefined })} className={tabButtonClass(tab === 'login')}>
            登录日志
          </Link>
          <Link href={auditHref(params, { tab: 'operation', page: 1, eventType: undefined })} className={tabButtonClass(tab === 'operation')}>
            操作日志
          </Link>
        </nav>
      </div>

      <form className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-6">
        <input type="hidden" name="tab" value={tab} />
        <input
          name="username"
          defaultValue={params.username}
          placeholder="操作人/用户"
          className="h-9 rounded-lg border bg-background px-3 text-sm"
        />
        {tab === 'login' ? (
          <select name="eventType" defaultValue={eventType ?? ''} className="h-9 rounded-lg border bg-background px-3 text-sm">
            <option value="">全部事件</option>
            {LOGIN_EVENT_VALUES.map((value) => <option key={value} value={value}>{LOGIN_EVENT_LABELS[value]}</option>)}
          </select>
        ) : (
          <>
            <select name="operation" defaultValue={operation ?? ''} className="h-9 rounded-lg border bg-background px-3 text-sm">
              <option value="">全部操作</option>
              {AUDIT_OPERATION_VALUES.map((value) => <option key={value} value={value}>{AUDIT_OPERATION_LABELS[value]}</option>)}
            </select>
            <input name="target" defaultValue={params.target} placeholder="目标 ID/名称" className="h-9 rounded-lg border bg-background px-3 text-sm" />
          </>
        )}
        <input type="date" name="startDate" defaultValue={params.startDate} aria-label="开始日期" className="h-9 rounded-lg border bg-background px-3 text-sm" />
        <input type="date" name="endDate" defaultValue={params.endDate} aria-label="结束日期" className="h-9 rounded-lg border bg-background px-3 text-sm" />
        <div className="flex gap-2">
          <button type="submit" className="h-9 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground">筛选</button>
          <Link href={`/audit-logs?tab=${tab}`} className="inline-flex h-9 items-center rounded-lg border px-4 text-sm">重置</Link>
        </div>
      </form>

      {/* 日志列表 */}
      {tab === 'login' ? (
        <Card className="border-none shadow-sm ring-1 ring-border/50 overflow-hidden rounded-xl">
          <CardContent className="p-0">
            <p className="mb-2 text-xs text-muted-foreground sm:hidden">表格可左右滑动查看更多字段</p>
            <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>用户</TableHead>
                  <TableHead>事件类型</TableHead>
                  <TableHead>IP 地址</TableHead>
                  <TableHead>User-Agent</TableHead>
                  <TableHead>失败原因</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="p-0">
                      <EmptyState variant="simple" icon={FileText} title="暂无日志记录" description="当前没有登录日志" />
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((log) => {
                    const loginLog = log as { id: string; createdAt: Date | string; username: string; eventType: string; ip: string | null; userAgent: string | null; failReason: string | null };
                    return (
                      <TableRow key={loginLog.id}>
                        <TableCell className="text-foreground">
                          {formatShanghaiDateTime(loginLog.createdAt)}
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
                        <TableCell className="max-w-64 truncate text-muted-foreground" title={loginLog.userAgent ?? undefined}>
                          {loginLog.userAgent || '-'}
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
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-none shadow-sm ring-1 ring-border/50 overflow-hidden rounded-xl">
          <CardContent className="p-0">
            <p className="mb-2 text-xs text-muted-foreground sm:hidden">表格可左右滑动查看更多字段</p>
            <div className="overflow-x-auto">
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
                      targetType: string | null;
                      targetId: string | null;
                      targetName: string | null;
                      changes: Record<string, unknown> | null;
                      status: number | null;
                      errorMsg: string | null;
                      ip: string | null;
                    };
                    return (
                      <TableRow key={opLog.id}>
                        <TableCell className="text-foreground">
                          {formatShanghaiDateTime(opLog.createdAt)}
                        </TableCell>
                        <TableCell className="text-foreground">
                          {opLog.username || '-'}
                        </TableCell>
                        <TableCell>
                          <span className="px-2 py-1 text-xs rounded-full bg-primary/10 text-primary">
                            {AUDIT_OPERATION_LABELS[opLog.operation as keyof typeof AUDIT_OPERATION_LABELS] || opLog.operation}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-xs truncate">
                          {[opLog.targetType, opLog.targetName || opLog.targetId].filter(Boolean).join(': ')
                            || opLog.url
                            || '-'}
                          {(opLog.changes || opLog.params) && (
                            <span className="block truncate text-[10px]" title={JSON.stringify(opLog.changes || opLog.params)}>
                              {JSON.stringify(opLog.changes || opLog.params)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className={`text-sm ${opLog.status === 200 ? 'text-success' : 'text-destructive'}`}>
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
            </div>
          </CardContent>
        </Card>
      )}

      {/* 分页 — searchParams 驱动 */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">共 {pagination.total} 条</span>
          <div className="flex items-center gap-2">
            <Link
              href={auditHref(params, { tab, page: page - 1 })}
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
              href={auditHref(params, { tab, page: page + 1 })}
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
