import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ScrollText } from 'lucide-react';
import {
  AUDIT_OPERATION_LABELS,
  LOGIN_EVENT_LABELS,
  type AuditOperation,
  type LoginEventType,
} from '@auth-sso/contracts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format-date';
import { formatIp } from '@/lib/format-ip';
import { isUuid } from '@/lib/uuid';
import { safeReturnPath } from '@/lib/safe-return';
import { getAccessLogById, getAuditLogById, getLoginLogById } from '@/app/audit/data';
import { AuditParamsActions } from './params-actions';
import { CopyTextButton } from '@/components/shared/copy-text-button';
import { PageHeader } from '@/components/shared/page-header';
import { PAGE_TITLES } from '@/lib/route-titles';

/** 读取会话/动态数据：与审计列表同口径，声明非 instant 路由 */
export const instant = false;
export const metadata = { title: `${PAGE_TITLES.AUDIT_DETAIL} | Auth-SSO` };

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; returnTo?: string }>;
}

function Field({ label, value, mono, copy }: { label: string; value: string; mono?: boolean; copy?: boolean }) {
  return (
    <div className="grid grid-cols-[92px_1fr] gap-3 border-b border-border/50 py-2 last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`flex min-w-0 items-start gap-1 ${mono ? 'font-mono text-xs' : 'text-sm'}`}>
        <span className="min-w-0 flex-1 break-all">{value}</span>
        {copy && value !== '-' ? <CopyTextButton text={value} label={`复制${label}`} /> : null}
      </dd>
    </div>
  );
}


export default async function AuditLogDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { tab, returnTo: rawReturn } = await searchParams;
  if (!isUuid(id)) notFound();
  /**
   * 深链可分享：详情页真实类型可能有登录/操作/访问三种，内部链接总是带 tab，
   * 但用户复制 URL 去掉 tab 后不应 404。显式 tab 优先；缺省时按 ID 探测，
   * 探测不到才 404（三个查询都走主键，成本可控）。
   */
  let effectiveTab: 'login' | 'operation' | 'access' | null =
    tab === 'login' || tab === 'operation' || tab === 'access' ? tab : null;
  if (!effectiveTab) {
    const [loginRow, operationRow, accessRow] = await Promise.all([
      getLoginLogById(id),
      getAuditLogById(id),
      getAccessLogById(id),
    ]);
    effectiveTab = loginRow ? 'login' : operationRow ? 'operation' : accessRow ? 'access' : null;
  }
  if (!effectiveTab) notFound();
  const fallbackTab = effectiveTab;
  const DETAIL_CARD = 'gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0';
  const DETAIL_HEADER = 'border-b bg-muted/30 px-3 py-2';
  const returnHref = safeReturnPath(rawReturn, `/audit-logs?tab=${fallbackTab}`, '/audit-logs');

  if (effectiveTab === 'login') {
    const row = await getLoginLogById(id);
    if (!row) notFound();
    const label = LOGIN_EVENT_LABELS[row.eventType as LoginEventType] ?? row.eventType;
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <PageHeader
          variant="sticky"
          title={PAGE_TITLES.AUDIT_DETAIL}
          backHref={returnHref}
          backLabel="返回审计日志"
          meta={<><Badge variant="secondary">{label}</Badge><span className="flex items-center gap-1 type-meta text-muted-foreground">ID {row.id}<CopyTextButton text={row.id} label="复制日志 ID" /></span></>}
        />
        <Card className={DETAIL_CARD}>
          <CardHeader className={DETAIL_HEADER}><CardTitle className="type-card-title">事件信息</CardTitle></CardHeader>
          <CardContent className="p-3">
            <dl>
              <Field label="时间" value={formatDateTime(row.createdAt)} />
              <Field label="用户" value={row.username} />
              <Field label="事件类型" value={label} />
              <Field label="IP 地址" value={formatIp(row.ip)} mono copy />
              {/* UX-15：成功/登出等事件的空字段（地理位置 -/失败原因 -）不渲染，只展示有值字段 */}
              {row.location && <Field label="地理位置" value={row.location} />}
              {row.failReason && <Field label="失败原因" value={row.failReason} mono />}
              <Field label="User-Agent" value={row.userAgent || '-'} mono copy />
            </dl>
            <div className="mt-3 text-xs">
              <Link className="text-link hover:underline" href={`/audit-logs?tab=login&keyword=${encodeURIComponent(row.username)}`}>
                查看该用户的登录记录 →
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (effectiveTab === 'access') {
    const row = await getAccessLogById(id);
    if (!row) notFound();
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <PageHeader
          variant="sticky"
          title={PAGE_TITLES.AUDIT_DETAIL}
          backHref={returnHref}
          backLabel="返回审计日志"
          meta={<><Badge variant="outline" size="sm" className="font-mono">{row.method}</Badge><span className="flex items-center gap-1 type-meta text-muted-foreground">ID {row.id}<CopyTextButton text={row.id} label="复制日志 ID" /></span></>}
        />
        <div className="grid gap-3 xl:grid-cols-3">
          <Card className={`${DETAIL_CARD} lg:col-span-2`}>
            <CardHeader className={DETAIL_HEADER}><CardTitle className="type-card-title">访问上下文</CardTitle></CardHeader>
            <CardContent className="p-3">
              <dl>
                <Field label="时间" value={formatDateTime(row.createdAt)} />
                <Field label="用户" value={row.username || (row.userId ? '未知用户（可能已删除）' : '匿名')} />
                <Field label="请求方法" value={row.method} mono />
                <Field label="路径" value={row.path} mono copy />
                <Field label="资源类型" value={row.resourceType || '-'} />
                <Field label="资源 ID" value={row.resourceId || '-'} mono />
                <Field label="状态码" value={String(row.status ?? '-')} />
                <Field label="耗时" value={row.duration != null ? `${row.duration} ms` : '-'} />
              </dl>
            </CardContent>
          </Card>
          <Card className={DETAIL_CARD}>
            <CardHeader className={DETAIL_HEADER}><CardTitle className="type-card-title">来源</CardTitle></CardHeader>
            <CardContent className="p-3">
              <dl>
                <Field label="IP 地址" value={formatIp(row.ip)} mono copy />
                <Field label="User-Agent" value={row.userAgent || '-'} mono copy />
              </dl>
              {row.username && (
                <div className="mt-3 text-xs">
                  <Link className="text-link hover:underline" href={`/audit-logs?tab=access&keyword=${encodeURIComponent(row.username)}`}>
                    查看该用户的访问记录 →
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const row = await getAuditLogById(id);
  if (!row) notFound();
  const opLabel = AUDIT_OPERATION_LABELS[row.operation as AuditOperation] ?? row.operation;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHeader
        variant="sticky"
        title={PAGE_TITLES.AUDIT_DETAIL}
        backHref={returnHref}
        backLabel="返回审计日志"
        meta={<><Badge size="sm">{opLabel}</Badge><span className="flex items-center gap-1 type-meta text-muted-foreground">ID {row.id}<CopyTextButton text={row.id} label="复制日志 ID" /></span></>}
      />
      <div className="grid gap-3 xl:grid-cols-3">
        <Card className={`${DETAIL_CARD} lg:col-span-2`}>
          <CardHeader className={DETAIL_HEADER}><CardTitle className="type-card-title">请求上下文</CardTitle></CardHeader>
          <CardContent className="p-3">
            <dl>
              <Field label="时间" value={formatDateTime(row.createdAt)} />
              <Field label="操作人" value={row.username || (row.userId ? '未知用户（可能已删除）' : '-')} />
              <Field label="操作类型" value={opLabel} />
              <Field label="请求方法" value={row.method || '-'} mono />
              <Field label="请求地址" value={row.url || '-'} mono copy />
              <Field label="状态码" value={String(row.status ?? '-')} />
              <Field label="耗时" value={row.duration != null ? `${row.duration} ms` : '-'} />
              <Field label="错误信息" value={row.errorMsg || '-'} mono />
            </dl>
          </CardContent>
        </Card>
        <Card className={DETAIL_CARD}>
          <CardHeader className={DETAIL_HEADER}><CardTitle className="type-card-title">来源</CardTitle></CardHeader>
          <CardContent className="p-3">
            <dl>
              <Field label="IP 地址" value={formatIp(row.ip)} mono copy />
              <Field label="User-Agent" value={row.userAgent || '-'} mono copy />
            </dl>
            {row.userId && (
              <div className="mt-3 text-xs">
                <Link className="text-link hover:underline" href={`/audit-logs?tab=operation&keyword=${encodeURIComponent(row.userId)}`}>
                  查看该目标用户的变更记录 →
                </Link>
              </div>
            )}
            {row.username && (
              <div className="mt-2 text-xs">
                <Link className="text-link hover:underline" href={`/audit-logs?tab=operation&keyword=${encodeURIComponent(row.username)}`}>
                  查看该操作人的审计记录 →
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <Card className={DETAIL_CARD}>
        <CardHeader className={`${DETAIL_HEADER} flex flex-row items-center gap-2`}>
          <ScrollText className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="type-card-title">变更参数</CardTitle>
          <AuditParamsActions id={row.id} params={row.params} />
        </CardHeader>
        <CardContent className="p-3">
          <pre className="overflow-x-auto rounded-md border border-border/60 bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
            {row.params ? JSON.stringify(row.params, null, 2) : '无（该操作未记录结构化参数）'}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
