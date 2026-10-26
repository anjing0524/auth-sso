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

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDateTime as formatDate } from '@/lib/format-date';

/**
 * 该路由读取会话/动态数据，**保留服务端阻塞**（Cache Components 的 instant 导航校验）。
 * 依据 Next 16 文档：启用 cacheComponents 后，读 session 的路由需显式声明；
 * 否则 Turbopack 运行时会报 "encountered uncached data during prerendering or a navigation"。
 */
export const instant = false;
export const metadata = { title: '审计日志 | Auth-SSO' };
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
    eventType?: string;
    operation?: string;
    range?: string;
    keyword?: string;
    startDate?: string;
    endDate?: string;
  }>;
}

/** 时间范围白名单（URL 参数值 → 距今天数）；非法值不下沉到 SQL */
const TIME_RANGES = ['24h', '7d', '30d'] as const;
type TimeRange = (typeof TIME_RANGES)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function resolveRange(value?: string): { range: TimeRange | null; startDate?: string; endDate?: string } {
  if (!value || !(TIME_RANGES as readonly string[]).includes(value)) return { range: null };
  const days = value === '24h' ? 1 : value === '7d' ? 7 : 30;
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const end = new Date().toISOString().slice(0, 10);
  return { range: value as TimeRange, startDate: start, endDate: end };
}

/** 自定义日期区间：预置范围优先；日期需 YYYY-MM-DD 且 start ≤ end，否则忽略（不下沉 SQL） */
function resolveDateFilters(
  rangeValue?: string, startParam?: string, endParam?: string,
): { range: TimeRange | null; startDate?: string; endDate?: string } {
  const preset = resolveRange(rangeValue);
  if (preset.range) return preset;
  const start = startParam && DATE_RE.test(startParam) ? startParam : undefined;
  const end = endParam && DATE_RE.test(endParam) ? endParam : undefined;
  if (start && end && start > end) return { range: null };
  return { range: null, startDate: start, endDate: end };
}

/** 生成分页链接的 href：保留当前 tab 与筛选条件（规模数据下必须可分享/可刷新） */
function pageHref(
  tab: string, page: number, eventType?: string | null, operation?: string | null, range?: TimeRange | null,
  keyword?: string | null, startDate?: string | null, endDate?: string | null,
): string {
  const params = new URLSearchParams({ tab });
  if (tab === 'login' && eventType) params.set('eventType', eventType);
  if (tab === 'operation' && operation) params.set('operation', operation);
  if (range) params.set('range', range);
  if (keyword) params.set('keyword', keyword);
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
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
  const { range, startDate, endDate } = resolveDateFilters(params.range, params.startDate, params.endDate);
  // 关键词长度上限 100（与导出 route 同口径），去除首尾空白
  const keyword = params.keyword?.trim().slice(0, 100) || null;

  // 按当前 tab 仅查询所需数据源，互斥取数；时间范围在数据层过滤（不是先取全量再前端筛）
  const { data, pagination } =
    tab === 'login'
      ? await getLoginLogs({ page, pageSize: PAGE_SIZE, ...(eventType ? { eventType } : {}), ...(startDate ? { startDate, endDate } : {}), ...(keyword ? { keyword } : {}) })
      : await getAuditLogs({ page, pageSize: PAGE_SIZE, ...(operation ? { operation } : {}), ...(startDate ? { startDate, endDate } : {}), ...(keyword ? { keyword } : {}) });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">

      {/* 标题 + 页签 + 类型筛选 + 导出：压缩为同一行（搜索/标题不应各占一整行） */}
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <h1 className="type-section-title shrink-0 text-foreground">审计日志</h1>
        <AuditTabs tab={tab} hrefs={{ login: pageHref('login', 1, null, null, range, keyword, startDate, endDate), operation: pageHref('operation', 1, null, null, range, keyword, startDate, endDate) }} />
        <AuditFilters tab={tab} eventType={eventType} operation={operation} range={range} keyword={keyword} startDate={startDate} endDate={endDate} />
        {canExport ? (
          <div className="ml-auto flex items-center gap-2">
            {/* 导出是次要动作：合并为一个下拉，避免两个按钮把筛选行挤换行（chrome 33%→≤30%） */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download className="h-3.5 w-3.5" /> 导出 CSV
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <a href={`/api/audit/export?type=login${eventType ? `&eventType=${eventType}` : ''}${startDate ? `&startDate=${startDate}&endDate=${endDate}` : ''}${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ''}`}>
                    导出登录日志（CSV）
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={`/api/audit/export?type=operation${operation ? `&operation=${operation}` : ''}${startDate ? `&startDate=${startDate}&endDate=${endDate}` : ''}${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ''}`}>
                    导出操作日志（CSV）
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>

      {/* U-G05（F3 遗留）：本页用裸 Table，无法复用 DataTable 内部提示；此处保留**唯一一份**
          与共享组件同口径的 lg:hidden 提示（此前两个分支各内联一份窄屏断点提示，窄桌面不可见）。 */}
      <p data-scroll-hint className="border-b bg-muted/30 px-4 py-1.5 text-[11px] text-muted-foreground lg:hidden">
        左右滑动查看完整表格
      </p>

      {/* 日志列表（U-LOG02：页签内容与 role=tablist 关联） */}
      <div id="audit-tabpanel" role="tabpanel" aria-labelledby={`audit-tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
      {tab === 'login' ? (
        <Card className="gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0">
          <CardContent className="p-0">
            <div className="scrollbar-slim max-h-[calc(100svh-19rem)] overflow-auto">
            <Table containerClassName="overflow-visible">
              <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-card">
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
        <Card className="gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0">
          <CardContent className="p-0">
            <div className="max-h-[calc(100svh-19rem)] overflow-auto">
            <Table containerClassName="overflow-visible">
              <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-card">
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
          hrefFor={(p) => pageHref(tab, p, eventType, operation, range, keyword, startDate, endDate)}
          jumpAction="/audit-logs"
          jumpParams={{ tab, ...(eventType ? { eventType } : {}), ...(operation ? { operation } : {}), ...(range ? { range } : {}), ...(keyword ? { keyword } : {}), ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) }}
        />
      )}
    </div>
  );
}
