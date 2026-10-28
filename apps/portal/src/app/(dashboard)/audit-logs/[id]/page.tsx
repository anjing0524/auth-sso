import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ScrollText } from 'lucide-react';
import {
  AUDIT_OPERATION_LABELS,
  LOGIN_EVENT_LABELS,
  type AuditOperation,
  type LoginEventType,
} from '@auth-sso/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format-date';
import { isUuid } from '@/lib/uuid';
import { getAccessLogById, getAuditLogById, getLoginLogById } from '@/app/audit/data';
import { AuditParamsActions } from './params-actions';
import { CopyTextButton } from '@/components/shared/copy-text-button';

/** 读取会话/动态数据：与审计列表同口径，声明非 instant 路由 */
export const instant = false;

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

function DetailHeader({ title, tab, id, returnHref, children }: { title: string; tab: 'login' | 'operation' | 'access'; id: string; returnHref: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="ghost" size="icon-sm" aria-label="返回审计日志">
        <Link href={returnHref}><ArrowLeft className="h-4 w-4" /></Link>
      </Button>
      <h1 className="type-section-title">{title}</h1>
      {children}
      <span className="flex items-center gap-1 type-meta text-muted-foreground">ID {id}<CopyTextButton text={id} label="复制日志 ID" /></span>
    </div>
  );
}

export default async function AuditLogDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { tab, returnTo: rawReturn } = await searchParams;
  if (!isUuid(id)) notFound();
  const fallbackTab = tab === 'login' || tab === 'access' ? tab : 'operation';
  const returnHref = rawReturn && rawReturn.startsWith('/audit-logs') && !rawReturn.startsWith('//')
    ? rawReturn
    : `/audit-logs?tab=${fallbackTab}`;

  if (tab === 'login') {
    const row = await getLoginLogById(id);
    if (!row) notFound();
    const label = LOGIN_EVENT_LABELS[row.eventType as LoginEventType] ?? row.eventType;
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <DetailHeader title="登录日志详情" tab="login" id={row.id} returnHref={returnHref}>
          <Badge variant="secondary">{label}</Badge>
        </DetailHeader>
        <Card className="border border-border/70 ring-0">
          <CardHeader><CardTitle className="type-card-title">事件信息</CardTitle></CardHeader>
          <CardContent>
            <dl>
              <Field label="时间" value={formatDateTime(row.createdAt)} />
              <Field label="用户" value={row.username} />
              <Field label="事件类型" value={label} />
              <Field label="IP 地址" value={row.ip ?? '-'} mono copy />
              <Field label="地理位置" value={row.location || '-'} />
              <Field label="失败原因" value={row.failReason || '-'} mono />
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

  if (tab === 'access') {
    const row = await getAccessLogById(id);
    if (!row) notFound();
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <DetailHeader title="访问日志详情" tab="access" id={row.id} returnHref={returnHref}>
          <Badge variant="outline" className="font-mono">{row.method}</Badge>
        </DetailHeader>
        <div className="grid gap-3 xl:grid-cols-3">
          <Card className="border border-border/70 ring-0 lg:col-span-2">
            <CardHeader><CardTitle className="type-card-title">访问上下文</CardTitle></CardHeader>
            <CardContent>
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
          <Card className="border border-border/70 ring-0">
            <CardHeader><CardTitle className="type-card-title">来源</CardTitle></CardHeader>
            <CardContent>
              <dl>
                <Field label="IP 地址" value={row.ip || '-'} mono copy />
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
      <DetailHeader title="操作日志详情" tab="operation" id={row.id} returnHref={returnHref}>
        <Badge>{opLabel}</Badge>
      </DetailHeader>
      <div className="grid gap-3 xl:grid-cols-3">
        <Card className="border border-border/70 ring-0 lg:col-span-2">
          <CardHeader><CardTitle className="type-card-title">请求上下文</CardTitle></CardHeader>
          <CardContent>
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
        <Card className="border border-border/70 ring-0">
          <CardHeader><CardTitle className="type-card-title">来源</CardTitle></CardHeader>
          <CardContent>
            <dl>
              <Field label="IP 地址" value={row.ip || '-'} mono copy />
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
      <Card className="border border-border/70 ring-0">
        <CardHeader className="flex flex-row items-center gap-2">
          <ScrollText className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="type-card-title">变更参数</CardTitle>
          <AuditParamsActions id={row.id} params={row.params} />
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md border border-border/60 bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
            {row.params ? JSON.stringify(row.params, null, 2) : '无（该操作未记录结构化参数）'}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
