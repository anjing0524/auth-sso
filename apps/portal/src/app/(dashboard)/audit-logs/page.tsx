/**
 * 审计日志页面 - Server Component 读模型入口
 *
 * 鉴权由 layout.tsx 统一处理（requirePermission(['audit:read'])），本组件零鉴权样板。
 * Tab 切换与分页均通过 searchParams 驱动（<Link> 渐进增强，无需 'use client'），
 * 直调 app/audit/data.ts 读模型，消除原先 client → /api/audit/* → data.ts 的双重跳转。
 *
 * v2 — shadcn Table + 设计 Token + 暗黑模式支持
 */
import { Download, X, Eye } from 'lucide-react';
import Link from 'next/link';
import { LOGIN_EVENT_LABELS, AUDIT_OPERATION_LABELS, LOGIN_EVENT_VALUES, AUDIT_OPERATION_VALUES, AUDIT_PERMISSIONS, can, type AuditOperation, type LoginEventType } from '@auth-sso/contracts';
import { AuditFilters } from './components/audit-filters';
import { getLoginLogs, getAuditLogs, getAccessLogs, getAccessLogResourceTypes } from '@/app/audit/data';
import { redirect } from 'next/navigation';
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
import { AuditTabs } from './components/audit-tabs';
import { OverflowHint } from './components/overflow-hint';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDate as formatDateOnly, formatTime, formatDateTime as formatDate } from '@/lib/format-date';

/**
 * 该路由读取会话/动态数据，**保留服务端阻塞**（Cache Components 的 instant 导航校验）。
 * 依据 Next 16 文档：启用 cacheComponents 后，读 session 的路由需显式声明；
 * 否则 Turbopack 运行时会报 "encountered uncached data during prerendering or a navigation"。
 */
export const instant = false;
export const metadata = { title: '审计日志 | Auth-SSO' };
const PAGE_SIZE = 20;

/** 登录事件 → Badge 语义变体（软底 token 的前景已满足 WCAG 4.5:1） */
const EVENT_TYPE_VARIANTS: Record<string, 'success' | 'destructive' | 'secondary' | 'outline' | 'warning'> = {
  LOGIN_SUCCESS: 'success',
  LOGIN_FAILED: 'destructive',
  LOGOUT: 'secondary',
  TOKEN_REFRESH: 'outline',
  TOKEN_REFRESH_FAILED: 'warning',
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
    status?: string;
    resourceType?: string;
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
  accessStatus?: string | null, accessResourceType?: string | null,
): string {
  const params = new URLSearchParams({ tab });
  if (tab === 'login' && eventType) params.set('eventType', eventType);
  if (tab === 'operation' && operation) params.set('operation', operation);
  if (tab === 'access' && accessStatus) params.set('status', accessStatus);
  if (tab === 'access' && accessResourceType) params.set('resourceType', accessResourceType);
  if (range) params.set('range', range);
  if (keyword) params.set('keyword', keyword);
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  if (page > 1) params.set('page', String(page));
  return `/audit-logs?${params.toString()}`;
}

export default async function AuditLogsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const tab: 'login' | 'operation' | 'access' = params.tab === 'operation' ? 'operation' : params.tab === 'access' ? 'access' : 'login';
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
  // 预置 range 的 startDate/endDate 是派生值：只用于查询/导出，不写回 URL（否则 chips 出现"近7天 + 日期"重复）
  const chipStartDate = range ? undefined : startDate;
  const chipEndDate = range ? undefined : endDate;
  // 关键词长度上限 100（与导出 route 同口径），去除首尾空白
  const keyword = params.keyword?.trim().slice(0, 100) || null;
  const accessStatus = params.status === 'SUCCESS' || params.status === 'FAILURE' ? params.status : null;
  const accessResourceType = params.resourceType?.trim().slice(0, 50) || null;
  const accessResourceTypes = tab === 'access' ? await getAccessLogResourceTypes() : [];
  const validAccessResourceType = accessResourceType && accessResourceTypes.includes(accessResourceType)
    ? accessResourceType : null;

  // 按当前 tab 仅查询所需数据源，互斥取数；时间范围在数据层过滤（不是先取全量再前端筛）
  const { data, pagination } =
    tab === 'login'
      ? await getLoginLogs({ page, pageSize: PAGE_SIZE, ...(eventType ? { eventType } : {}), ...(startDate ? { startDate, endDate } : {}), ...(keyword ? { keyword } : {}) })
      : tab === 'operation'
        ? await getAuditLogs({ page, pageSize: PAGE_SIZE, ...(operation ? { operation } : {}), ...(startDate ? { startDate, endDate } : {}), ...(keyword ? { keyword } : {}) })
        : await getAccessLogs({
            page, pageSize: PAGE_SIZE,
            ...(startDate ? { startDate, endDate } : {}),
            ...(keyword ? { keyword } : {}),
            ...(accessStatus ? { status: accessStatus } : {}),
            ...(validAccessResourceType ? { resourceType: validAccessResourceType } : {}),
          });

  if (pagination.totalPages > 0 && page > pagination.totalPages) {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key !== 'page' && typeof value === 'string' && value) q.set(key, value);
    }
    q.set('page', String(pagination.totalPages));
    redirect(`/audit-logs?${q.toString()}`);
  }

  // 当前筛选摘要：让"为什么列表是这些"可解释，并支持单个移除/一键清空
  const filterChips: Array<{ label: string; href: string }> = [];
  if (tab === 'login' && eventType) {
    filterChips.push({
      label: LOGIN_EVENT_LABELS[eventType] ?? eventType,
      href: pageHref(tab, 1, null, operation, range, keyword, chipStartDate, chipEndDate),
    });
  }
  if (tab === 'operation' && operation) {
    filterChips.push({
      label: AUDIT_OPERATION_LABELS[operation] ?? operation,
      href: pageHref(tab, 1, eventType, null, range, keyword, chipStartDate, chipEndDate),
    });
  }
  if (range) {
    const rangeLabel = range === '24h' ? '近 24 小时' : range === '7d' ? '近 7 天' : '近 30 天';
    filterChips.push({
      label: rangeLabel,
      href: pageHref(tab, 1, eventType, operation, null, keyword, undefined, undefined),
    });
  }
  if (!range && (startDate || endDate)) {
    filterChips.push({
      label: `日期 ${startDate ?? '…'} ~ ${endDate ?? '…'}`,
      href: pageHref(tab, 1, eventType, operation, null, keyword, null, null),
    });
  }
  if (keyword) {
    filterChips.push({
      label: `关键词：${keyword}`,
      href: pageHref(tab, 1, eventType, operation, range, null, chipStartDate, chipEndDate, accessStatus, validAccessResourceType),
    });
  }
  if (tab === 'access' && accessStatus) {
    filterChips.push({
      label: accessStatus === 'SUCCESS' ? '状态：成功' : '状态：失败',
      href: pageHref(tab, 1, eventType, operation, range, keyword, chipStartDate, chipEndDate, null, validAccessResourceType),
    });
  }
  if (tab === 'access' && validAccessResourceType) {
    filterChips.push({
      label: `资源：${validAccessResourceType}`,
      href: pageHref(tab, 1, eventType, operation, range, keyword, chipStartDate, chipEndDate, accessStatus, null),
    });
  }

  const currentListHref = pageHref(tab, page, eventType, operation, range, keyword, chipStartDate, chipEndDate, accessStatus, validAccessResourceType);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">

      {/* 标题 + 页签 + 类型筛选 + 导出：压缩为同一行（搜索/标题不应各占一整行） */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 xl:gap-3">
        <h1 className="type-section-title shrink-0 text-foreground">审计日志</h1>
        <AuditTabs tab={tab} hrefs={{ login: pageHref('login', 1, null, null, range, keyword, chipStartDate, chipEndDate), operation: pageHref('operation', 1, null, null, range, keyword, chipStartDate, chipEndDate), access: pageHref('access', 1, null, null, range, keyword, chipStartDate, chipEndDate, accessStatus, validAccessResourceType) }} />
        <AuditFilters
          tab={tab}
          eventType={eventType}
          operation={operation}
          range={range}
          keyword={keyword}
          startDate={chipStartDate}
          endDate={chipEndDate}
          accessStatus={accessStatus}
          accessResourceType={validAccessResourceType}
          accessResourceTypes={accessResourceTypes}
        />
        {canExport ? (
          <div className="ml-auto flex items-center gap-2 max-md:ml-0 max-md:w-full">
            {/* 导出是次要动作：合并为一个下拉，避免两个按钮把筛选行挤换行（chrome 33%→≤30%） */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="max-md:w-full" aria-label="导出 CSV" title="导出 CSV">
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
                <DropdownMenuItem asChild>
                  <a href={`/api/audit/export?type=access${startDate ? `&startDate=${startDate}&endDate=${endDate}` : ''}${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ''}${accessStatus ? `&status=${accessStatus}` : ''}${validAccessResourceType ? `&resourceType=${encodeURIComponent(validAccessResourceType)}` : ''}`}>
                    导出访问日志（CSV）
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>

      {filterChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
          <span className="shrink-0">当前筛选</span>
          {filterChips.map((chip) => (
            <Link
              key={chip.label}
              href={chip.href}
              title={`移除筛选：${chip.label}`}
              className="inline-flex items-center gap-1 rounded border border-border/60 bg-card px-1.5 py-0.5 text-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
            >
              {chip.label}
              <X className="h-3 w-3" />
            </Link>
          ))}
          <Link href={`/audit-logs?tab=${tab}`} className="ml-auto shrink-0 text-muted-foreground hover:text-destructive">
            清除全部
          </Link>
        </div>
      )}

      {/* 日志列表（U-LOG02：页签内容与 role=tablist 关联） */}
      <div id="audit-tabpanel" role="tabpanel" aria-labelledby={`audit-tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
      {tab === 'login' ? (
        <Card className="gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0">
          <CardContent className="p-0">
            <OverflowHint>
            <div className="scrollbar-slim max-h-[calc(100svh-19rem)] overflow-auto">
            <Table containerClassName="overflow-visible">
              <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-card">
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>用户</TableHead>
                  <TableHead className="hidden md:table-cell">事件类型</TableHead>
                  <TableHead className="hidden md:table-cell">IP 地址</TableHead>
                  <TableHead className="hidden md:table-cell">失败原因</TableHead>
                  <TableHead className="text-right">详情</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="p-0">
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
                          <span className="md:hidden">{formatDateOnly(loginLog.createdAt)}<br />{formatTime(loginLog.createdAt)}</span>
                          <span className="hidden md:inline">{formatDate(loginLog.createdAt)}</span>
                        </TableCell>
                        <TableCell className="text-foreground">
                          {loginLog.username}
                          <span className="mt-0.5 block md:hidden">
                            <Badge variant={EVENT_TYPE_VARIANTS[loginLog.eventType] ?? 'secondary'}>
                              {LOGIN_EVENT_LABELS[loginLog.eventType as keyof typeof LOGIN_EVENT_LABELS] || loginLog.eventType}
                            </Badge>
                          </span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <Badge variant={EVENT_TYPE_VARIANTS[loginLog.eventType] ?? 'secondary'}>
                            {LOGIN_EVENT_LABELS[loginLog.eventType as keyof typeof LOGIN_EVENT_LABELS] || loginLog.eventType}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">
                          {loginLog.ip || '-'}
                        </TableCell>
                        <TableCell className={`hidden md:table-cell ${loginLog.failReason ? 'text-destructive' : 'text-muted-foreground'}`}>
                          {loginLog.failReason || '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild variant="ghost" size="icon-sm" aria-label="查看日志详情">
                            <Link href={`/audit-logs/${loginLog.id}?tab=login&returnTo=${encodeURIComponent(currentListHref)}`}><Eye className="h-4 w-4" /></Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            </div>
            </OverflowHint>
          </CardContent>
        </Card>
      ) : tab === 'operation' ? (
        <Card className="gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0">
          <CardContent className="p-0">
            <OverflowHint>
            <div className="max-h-[calc(100svh-19rem)] overflow-auto">
            <Table containerClassName="overflow-visible">
              <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-card">
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>操作人</TableHead>
                  <TableHead>操作类型</TableHead>
                  <TableHead className="hidden md:table-cell">请求地址</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="hidden md:table-cell">IP</TableHead>
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
                          <span className="md:hidden">{formatDateOnly(opLog.createdAt)}<br />{formatTime(opLog.createdAt)}</span>
                          <span className="hidden md:inline">{formatDate(opLog.createdAt)}</span>
                        </TableCell>
                        <TableCell className="text-foreground">
                          {opLog.username || '-'}
                        </TableCell>
                        <TableCell>
                          <Badge className="border-none bg-primary/10 text-foreground">
                            {AUDIT_OPERATION_LABELS[opLog.operation as keyof typeof AUDIT_OPERATION_LABELS] || opLog.operation}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden max-w-xs truncate text-muted-foreground md:table-cell">
                          {opLog.url || (opLog.params ? JSON.stringify(opLog.params) : '') || '-'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={opLog.status === 200 ? 'success' : 'destructive'} className="tabular-nums">
                            {opLog.status || '-'}
                          </Badge>
                          {opLog.errorMsg && (
                            <span className="ml-2 text-xs text-destructive">({opLog.errorMsg})</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">
                          {opLog.ip || '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild variant="ghost" size="icon-sm" aria-label="查看日志详情">
                            <Link href={`/audit-logs/${opLog.id}?tab=operation&returnTo=${encodeURIComponent(currentListHref)}`}><Eye className="h-4 w-4" /></Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            </div>
            </OverflowHint>
          </CardContent>
        </Card>
      ) : (
        <Card className="gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0">
          <CardContent className="p-0">
            <OverflowHint>
            <div className="scrollbar-slim max-h-[calc(100svh-19rem)] overflow-auto">
            <Table containerClassName="overflow-visible">
              <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-card">
                <TableRow>
                  <TableHead className="hidden md:table-cell">时间</TableHead>
                  <TableHead>用户</TableHead>
                  <TableHead className="hidden md:table-cell">方法</TableHead>
                  <TableHead className="hidden md:table-cell">路径 / 资源</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="hidden md:table-cell">IP</TableHead>
                  <TableHead className="text-right">详情</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="p-0">
                      {keyword ? (
                        <EmptyState variant="simple" kind="filtered" icon="FileText" clearAction={{ label: '清除筛选', href: '/audit-logs?tab=access' }} />
                      ) : (
                        <EmptyState variant="simple" icon="FileText" title="暂无日志记录" description="当前没有访问日志" />
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((log) => {
                    const accessLog = log as {
                      id: string; createdAt: Date | string; username: string | null; method: string;
                      path: string; resourceType: string | null; status: number | null; ip: string | null;
                    };
                    return (
                      <TableRow key={accessLog.id}>
                        <TableCell className="hidden text-foreground md:table-cell">
                          <span className="hidden md:inline">{formatDate(accessLog.createdAt)}</span>
                        </TableCell>
                        <TableCell className="text-foreground">
                          <span className="block max-w-[120px] truncate md:max-w-none" title={accessLog.username ?? undefined}>{accessLog.username || '-'}</span>
                          <span className="mt-0.5 block text-[10px] text-muted-foreground md:hidden">
                            {formatDateOnly(accessLog.createdAt)} {formatTime(accessLog.createdAt)}
                          </span>
                          <span className="mt-0.5 block max-w-[140px] truncate font-mono text-[10px] text-muted-foreground md:hidden" title={accessLog.path}>
                            {accessLog.method} {accessLog.path}
                          </span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <Badge variant="outline" className="font-mono text-[10px]">{accessLog.method}</Badge>
                        </TableCell>
                        <TableCell className="hidden max-w-xs truncate font-mono text-[11px] text-muted-foreground md:table-cell" title={accessLog.path}>
                          {accessLog.path}
                          {accessLog.resourceType ? ` · ${accessLog.resourceType}` : ''}
                        </TableCell>
                        <TableCell>
                          <Badge variant={accessLog.status === 200 ? 'success' : 'destructive'} className="tabular-nums">
                            {accessLog.status ?? '-'}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">{accessLog.ip || '-'}</TableCell>
                        <TableCell className="text-right">
                          <Button asChild variant="ghost" size="icon-sm" aria-label="查看日志详情">
                            <Link href={`/audit-logs/${accessLog.id}?tab=access&returnTo=${encodeURIComponent(currentListHref)}`}><Eye className="h-4 w-4" /></Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            </div>
            </OverflowHint>
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
          hrefFor={(p) => pageHref(tab, p, eventType, operation, range, keyword, chipStartDate, chipEndDate, accessStatus, validAccessResourceType)}
          jumpAction="/audit-logs"
          jumpParams={{ tab, ...(eventType ? { eventType } : {}), ...(operation ? { operation } : {}), ...(range ? { range } : {}), ...(keyword ? { keyword } : {}), ...(chipStartDate ? { startDate: chipStartDate } : {}), ...(chipEndDate ? { endDate: chipEndDate } : {}) }}
        />
      )}
    </div>
  );
}
