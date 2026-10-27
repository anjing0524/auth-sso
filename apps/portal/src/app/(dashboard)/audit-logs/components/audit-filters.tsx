'use client';

/**
 * 审计日志筛选器（规模数据下必需）。
 *
 * 背景：5251 条日志只有“登录/操作”两个页签，无法按事件/操作类型缩小范围；
 * 数据层 `getLoginLogs(eventType)` / `getAuditLogs(operation)` 早已支持，只是 UI 没接。
 * 本组件把筛选写进 URL（tab + eventType/operation），支持刷新/分享/后退，并重置页码。
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AUDIT_OPERATION_LABELS,
  LOGIN_EVENT_LABELS,
  type AuditOperation,
  type LoginEventType,
} from '@auth-sso/contracts';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchInput } from '@/components/shared/search-input';
import { Input } from '@/components/ui/input';

interface Props {
  tab: 'login' | 'operation' | 'access';
  /** 访问日志：状态 / 资源类型 */
  accessStatus?: 'SUCCESS' | 'FAILURE' | null;
  accessResourceType?: string | null;
  accessResourceTypes?: string[];
  eventType?: LoginEventType | null;
  operation?: AuditOperation | null;
  /** 时间范围（24h/7d/30d）；与 tab/类型筛选一起写进 URL */
  range?: '24h' | '7d' | '30d' | null;
  /** 关键词（用户名/IP/URL）；300ms 防抖后写 URL */
  keyword?: string | null;
  /** 自定义区间（YYYY-MM-DD）；与预置 range 互斥 */
  startDate?: string | null;
  endDate?: string | null;
}

const TIME_RANGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'ALL', label: '全部时间' },
  { value: '24h', label: '近 24 小时' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: 'CUSTOM', label: '自定义日期' },
];

export function AuditFilters({ tab, eventType, operation, range, keyword, startDate, endDate, accessStatus, accessResourceType, accessResourceTypes = [] }: Props) {
  const [kw, setKw] = useState(keyword ?? '');
  // 自定义区间是独立模式：进入后保留已填日期，切回预置/全部时清空
  const [customMode, setCustomMode] = useState(!range && Boolean(startDate || endDate));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  const push = (next: { eventType?: string | null; operation?: string | null; range?: string | null; keyword?: string | null; startDate?: string | null; endDate?: string | null; status?: string | null; resourceType?: string | null }) => {
    const params = new URLSearchParams();
    params.set('tab', tab);
    const ev = next.eventType !== undefined ? next.eventType : eventType;
    const op = next.operation !== undefined ? next.operation : operation;
    const rg = next.range !== undefined ? next.range : range;
    if (tab === 'login' && ev) params.set('eventType', ev);
    if (tab === 'operation' && op) params.set('operation', op);
    const st = next.status !== undefined ? next.status : accessStatus;
    const rt = next.resourceType !== undefined ? next.resourceType : accessResourceType;
    if (tab === 'access' && st) params.set('status', st);
    if (tab === 'access' && rt) params.set('resourceType', rt);
    if (rg) params.set('range', rg);
    const kwd = next.keyword !== undefined ? next.keyword : keyword;
    if (kwd) params.set('keyword', kwd);
    const sd = next.startDate !== undefined ? next.startDate : startDate;
    const ed = next.endDate !== undefined ? next.endDate : endDate;
    if (sd) params.set('startDate', sd);
    if (ed) params.set('endDate', ed);
    router.push(`/audit-logs?${params.toString()}`);
  };

  // 关键词：本地即时回显，300ms 后同步 URL（避免每字符一次导航）
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = kw.trim();
      if (next === (keyword ?? '')) return;
      push({ keyword: next || null });
    }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在输入变化时触发；push 依赖当前 props
  }, [kw]);


  const selectValue = range ?? (customMode ? 'CUSTOM' : 'ALL');
  const timeRangeSelect = (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={selectValue}
        onValueChange={(v) => {
          if (v === 'CUSTOM') {
            setCustomMode(true);
            push({ range: null });
          } else if (v === 'ALL') {
            setCustomMode(false);
            push({ range: null, startDate: null, endDate: null });
          } else {
            setCustomMode(false);
            push({ range: v, startDate: null, endDate: null });
          }
        }}
      >
        <SelectTrigger aria-label="时间范围筛选" className="w-32">
          <SelectValue>{TIME_RANGE_OPTIONS.find((o) => o.value === selectValue)?.label ?? '全部时间'}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {TIME_RANGE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {customMode && (
        <>
          <Input
            type="date" aria-label="开始日期" value={startDate ?? ''} className="w-32"
            onChange={(e) => push({ startDate: e.target.value || null })}
          />
          <span className="text-[11px] text-muted-foreground">至</span>
          <Input
            type="date" aria-label="结束日期" value={endDate ?? ''} className="w-32"
            onChange={(e) => push({ endDate: e.target.value || null })}
          />
        </>
      )}
    </div>
  );

  if (tab === 'access') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput placeholder="搜索用户 / 路径 / IP..." value={kw} onChange={setKw} className="w-full md:w-36 xl:w-44" />
        <Select value={accessStatus ?? 'ALL'} onValueChange={(v) => push({ status: v === 'ALL' ? null : v })}>
          <SelectTrigger aria-label="访问状态筛选" className="w-32">
            <SelectValue>{accessStatus === 'SUCCESS' ? '成功' : accessStatus === 'FAILURE' ? '失败' : '全部状态'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部状态</SelectItem>
            <SelectItem value="SUCCESS">成功</SelectItem>
            <SelectItem value="FAILURE">失败</SelectItem>
          </SelectContent>
        </Select>
        <Select value={accessResourceType ?? 'ALL'} onValueChange={(v) => push({ resourceType: v === 'ALL' ? null : v })}>
          <SelectTrigger aria-label="资源类型筛选" className="w-40">
            <SelectValue>{accessResourceType ?? '全部资源类型'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部资源类型</SelectItem>
            {accessResourceTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        {timeRangeSelect}
      </div>
    );
  }

  if (tab === 'login') {
    return (
      <div className="flex flex-wrap items-center gap-2">
      <SearchInput placeholder="搜索用户 / IP..." value={kw} onChange={setKw} className="w-full md:w-36 xl:w-44" />
      <Select value={eventType ?? 'ALL'} onValueChange={(v) => push({ eventType: v === 'ALL' ? null : v })}>
        <SelectTrigger aria-label="事件类型筛选" className="w-40">
          <SelectValue>{eventType ? LOGIN_EVENT_LABELS[eventType] : '全部事件类型'}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">全部事件类型</SelectItem>
          {(Object.keys(LOGIN_EVENT_LABELS) as LoginEventType[]).map((key) => (
            <SelectItem key={key} value={key}>{LOGIN_EVENT_LABELS[key]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {timeRangeSelect}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
    <SearchInput placeholder="搜索用户 / IP / 地址..." value={kw} onChange={setKw} className="w-full md:w-36 xl:w-44" />
    <Select value={operation ?? 'ALL'} onValueChange={(v) => push({ operation: v === 'ALL' ? null : v })}>
      <SelectTrigger aria-label="操作类型筛选" className="w-40">
        <SelectValue>{operation ? AUDIT_OPERATION_LABELS[operation] : '全部操作类型'}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ALL">全部操作类型</SelectItem>
        {(Object.keys(AUDIT_OPERATION_LABELS) as AuditOperation[]).map((key) => (
          <SelectItem key={key} value={key}>{AUDIT_OPERATION_LABELS[key]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
    {timeRangeSelect}
    </div>
  );
}