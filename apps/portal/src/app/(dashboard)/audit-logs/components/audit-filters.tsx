'use client';

/**
 * 审计日志筛选器（规模数据下必需）。
 *
 * 背景：5251 条日志只有“登录/操作”两个页签，无法按事件/操作类型缩小范围；
 * 数据层 `getLoginLogs(eventType)` / `getAuditLogs(operation)` 早已支持，只是 UI 没接。
 * 本组件把筛选写进 URL（tab + eventType/operation），支持刷新/分享/后退，并重置页码。
 */
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

interface Props {
  tab: 'login' | 'operation';
  eventType?: LoginEventType | null;
  operation?: AuditOperation | null;
}

export function AuditFilters({ tab, eventType, operation }: Props) {
  const router = useRouter();

  const push = (next: { eventType?: string | null; operation?: string | null }) => {
    const params = new URLSearchParams();
    params.set('tab', tab);
    const ev = next.eventType !== undefined ? next.eventType : eventType;
    const op = next.operation !== undefined ? next.operation : operation;
    if (tab === 'login' && ev) params.set('eventType', ev);
    if (tab === 'operation' && op) params.set('operation', op);
    router.push(`/audit-logs?${params.toString()}`);
  };

  if (tab === 'login') {
    return (
      <Select value={eventType ?? 'ALL'} onValueChange={(v) => push({ eventType: v === 'ALL' ? null : v })}>
        <SelectTrigger aria-label="事件类型筛选" className="w-48">
          <SelectValue>{eventType ? LOGIN_EVENT_LABELS[eventType] : '全部事件类型'}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">全部事件类型</SelectItem>
          {(Object.keys(LOGIN_EVENT_LABELS) as LoginEventType[]).map((key) => (
            <SelectItem key={key} value={key}>{LOGIN_EVENT_LABELS[key]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Select value={operation ?? 'ALL'} onValueChange={(v) => push({ operation: v === 'ALL' ? null : v })}>
      <SelectTrigger aria-label="操作类型筛选" className="w-48">
        <SelectValue>{operation ? AUDIT_OPERATION_LABELS[operation] : '全部操作类型'}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ALL">全部操作类型</SelectItem>
        {(Object.keys(AUDIT_OPERATION_LABELS) as AuditOperation[]).map((key) => (
          <SelectItem key={key} value={key}>{AUDIT_OPERATION_LABELS[key]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
