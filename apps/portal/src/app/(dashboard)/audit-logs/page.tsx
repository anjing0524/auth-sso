/**
 * 审计日志页面 - Server Component 读模型入口
 *
 * 鉴权由 layout.tsx 统一处理（requirePermission(['audit:read'])），本组件零鉴权样板。
 * Tab 切换与分页均通过 searchParams 驱动（<Link> 渐进增强，无需 'use client'），
 * 直调 app/audit/data.ts 读模型，消除原先 client → /api/audit/* → data.ts 的双重跳转。
 *
 * v2 — shadcn Table + 设计 Token + 暗黑模式支持
 */
import { Download } from 'lucide-react';
import { LOGIN_EVENT_LABELS, AUDIT_OPERATION_LABELS, LOGIN_EVENT_VALUES, AUDIT_OPERATION_VALUES, AUDIT_PERMISSIONS, can, type AuditOperation, type LoginEventType } from '@auth-sso/contracts';
import { AuditFilters } from './components/audit-filters';
import { getLoginLogs, getAuditLogs } from '@/app/audit/data';
import { clampPage } from '@/lib/pagination';
import { resolveIdentity } from '@/lib/auth';
import { getUserPermissionContext, toPermissionContextOrNull } from '@/lib/permissions';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/empty-state';
import { TablePagination } from '@/components/shared/table-pagination';
import { Badge } from '@/components/ui/badge';
import { AuditLogDetailDialog } from './components/audit-log-detail-dialog';
import { AuditTabs } from './components/audit-tabs';

import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { formatDateTime as formatDate } from '@/lib/format-date';

/**
 * 该路由读取会话/动态数据，**保留服务端阻塞**（Cache Components 的 instant 导航校验）。
 * 依据 Next 16 文档：启用 cacheComponents 后，读 session 的路由需显式声明；
 * 否则 Turbopack 运行时会报 "encountered uncached data during prerendering or a navigation"。
 */
export const instant = false;
export const metadata = { title: '审计日志 | Auth-SSO' };
const PAGE_SIZE = 15;

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
    eventType?: string;
    operation?: string;
  }>;
}

/** 生成分页链接的 href：保留当前 tab 与筛选条件（规模数据下必须可分享/可刷新） */
function pageHref(tab: string, page: number, eventType?: string | null, operation?: string | null): string {
  const params = new URLSearchParams({ tab });
  if (tab === 'login' && eventType) params.set('eventType', eventType);
  if (tab === 'operation' && operation) params.set('operation', operation);
  if (page > 1) params.set('page', String(page));
  return `/audit-logs?${params.toString()}`;
}

export default async function AuditLogsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const tab: 'login' | 'operation' = params.tab === 'operation' ? 'operation' : 'login';
  const page = clampPage(params.page);

  // 导出是独立权限（audit:export）；只有 audit:read 的用户不应看到会 403 的按钮。
  const identity = await resolveIdentity();
  const permCtx = identity ? toPermissionContextOrNull(await getUserPermissionContext(identity.userId)) : null;
  const canExport = can(
    { roleCodes: permCtx?.roles.map((r) => r.code) ?? [], permissionCodes: permCtx?.permissions ?? [] },
    AUDIT_PERMISSIONS.EXPORT,
  );

  // 筛选参数必须走枚举白名单（非法值不得下沉到 SQL/枚举查询）
  const eventType = LOGIN_EVENT_VALUES.includes(params.eventType as LoginEventType)
    ? (params.eventType as LoginEventType) : null;
  const operation = AUDIT_OPERATION_VALUES.includes(params.operation as AuditOperation)
    ? (params.operation as AuditOperation) : null;

  // 按当前 tab 仅查询所需数据源，互斥取数
  const { data, pagination } =
    tab === 'login'
      ? await getLoginLogs({ page, pageSize: PAGE_SIZE, ...(eventType ? { eventType } : {}) })
      : await getAuditLogs({ page, pageSize: PAGE_SIZE, ...(operation ? { operation } : {}) });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <PageHeader
        icon="ShieldAlert"
        title="审计日志"
        description="追踪系统登录记录与管理员操作行为。"
        actions={
          canExport ? (
            <>
              <Button variant="outline" asChild>
                <a href={`/api/audit/export?type=login${eventType ? `&eventType=${eventType}` : ''}`}>
                  <Download className="h-4 w-4" /> 导出登录 CSV
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a href={`/api/audit/export?type=operation${operation ? `&operation=${operation}` : ''}`}>
                  <Download className="h-4 w-4" /> 导出操作 CSV
                </a>
              </Button>
            </>
          ) : undefined
        }
      />

      {/* Tab 切换 + 类型筛选 — searchParams 驱动；筛选在规模数据下必需 */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
      <AuditTabs tab={tab} hrefs={{ login: pageHref('login', 1), operation: pageHref('operation', 1) }} />
      <AuditFilters tab={tab} eventType={eventType} operation={operation} />
      </div>

      {/* U-G05（F3 遗留）：本页用裸 Table，无法复用 DataTable 内部提示；此处保留**唯一一份**
          与共享组件同口径的 lg:hidden 提示（此前两个分支各内联一份窄屏断点提示，窄桌面不可见）。 */}
      <p data-scroll-hint className="border-b bg-muted/30 px-4 py-1.5 text-[11px] text-muted-foreground lg:hidden">
        左右滑动查看完整表格
      </p>

      {/* 日志列表（U-LOG02：页签内容与 role=tablist 关联） */}
      <div id="audit-tabpanel" role="tabpanel" aria-labelledby={`audit-tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
      {tab === 'login' ? (
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border-none shadow-sm ring-1 ring-border/50">
          <CardContent className="flex min-h-0 flex-1 flex-col p-0">
            <div className="min-h-0 flex-1 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted/50">
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>用户</TableHead>
                  <TableHead>事件类型</TableHead>
                  <TableHead>IP 地址</TableHead>
                  <TableHead>失败原因</TableHead>
                  <TableHead className="text-right">详情</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="p-0">
                      {eventType ? (
                        <EmptyState
                          variant="simple"
                          kind="filtered"
                          icon="FileText"
                          clearAction={{ label: '清除筛选', href: '/audit-logs?tab=login' }}
                        />
                      ) : (
                        <EmptyState variant="simple" icon="FileText" title="暂无日志记录" description="当前没有登录日志" />
                      )}
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
                          <Badge className={`border-none ${EVENT_TYPE_COLORS[loginLog.eventType] || 'bg-muted text-muted-foreground'}`}>
                            {LOGIN_EVENT_LABELS[loginLog.eventType as keyof typeof LOGIN_EVENT_LABELS] || loginLog.eventType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {loginLog.ip || '-'}
                        </TableCell>
                        <TableCell className={loginLog.failReason ? 'text-destructive' : 'text-muted-foreground'}>
                          {loginLog.failReason || '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <AuditLogDetailDialog
                            title="登录日志详情"
                            description="该条登录事件的完整记录"
                            fields={[
                              { label: '时间', value: formatDate(loginLog.createdAt) },
                              { label: '用户', value: loginLog.username },
                              { label: '事件类型', value: LOGIN_EVENT_LABELS[loginLog.eventType as keyof typeof LOGIN_EVENT_LABELS] || loginLog.eventType },
                              { label: 'IP 地址', value: loginLog.ip || '-', mono: true },
                              { label: '失败原因', value: loginLog.failReason || '-', mono: true },
                            ]}
                          />
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
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border-none shadow-sm ring-1 ring-border/50">
          <CardContent className="flex min-h-0 flex-1 flex-col p-0">
            <div className="min-h-0 flex-1 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted/50">
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>操作人</TableHead>
                  <TableHead>操作类型</TableHead>
                  <TableHead>请求地址</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead className="text-right">详情</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="p-0">
                      {operation ? (
                        <EmptyState
                          variant="simple"
                          kind="filtered"
                          icon="FileText"
                          clearAction={{ label: '清除筛选', href: '/audit-logs?tab=operation' }}
                        />
                      ) : (
                        <EmptyState variant="simple" icon="FileText" title="暂无日志记录" description="当前没有操作日志" />
                      )}
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
                          <Badge className="border-none bg-primary/10 text-primary">
                            {AUDIT_OPERATION_LABELS[opLog.operation as keyof typeof AUDIT_OPERATION_LABELS] || opLog.operation}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-xs truncate">
                          {opLog.url || (opLog.params ? JSON.stringify(opLog.params) : '') || '-'}
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
                        <TableCell className="text-right">
                          <AuditLogDetailDialog
                            title="操作日志详情"
                            description="该次管理操作的完整上下文"
                            fields={[
                              { label: '时间', value: formatDate(opLog.createdAt) },
                              { label: '操作人', value: opLog.username || '-' },
                              { label: '操作类型', value: AUDIT_OPERATION_LABELS[opLog.operation as keyof typeof AUDIT_OPERATION_LABELS] || opLog.operation },
                              { label: '请求地址', value: opLog.url || '-', mono: true },
                              { label: '状态码', value: String(opLog.status ?? '-') },
                              { label: '错误信息', value: opLog.errorMsg || '-', mono: true },
                              { label: 'IP 地址', value: opLog.ip || '-', mono: true },
                              { label: '变更参数', value: opLog.params ? JSON.stringify(opLog.params, null, 2) : '无', mono: true },
                            ]}
                          />
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
      </div>

      {/* 分页 — searchParams 驱动 */}
      {pagination.totalPages > 1 && (
        <TablePagination
          page={page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          hrefFor={(p) => pageHref(tab, p, eventType, operation)}
          jumpAction="/audit-logs"
          jumpParams={{ tab, ...(eventType ? { eventType } : {}), ...(operation ? { operation } : {}) }}
        />
      )}
    </div>
  );
}
