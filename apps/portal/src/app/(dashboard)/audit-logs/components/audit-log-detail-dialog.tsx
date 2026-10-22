'use client';

/**
 * 审计日志详情弹窗（FR-LOG-02 / J-LOG-001：变更参数 / IP / 状态）
 *
 * 列表页只放得下摘要，`params` 等完整上下文此前没有任何展示入口；
 * 本组件接收服务端整理好的字段（避免把 Date/JSON 序列化逻辑散到客户端）。
 */
import { Eye } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export interface AuditDetailField {
  label: string;
  value: string;
  mono?: boolean;
}

export function AuditLogDetailDialog({
  title,
  description,
  fields,
}: {
  title: string;
  description: string;
  fields: AuditDetailField[];
}) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="查看日志详情" />}>
        <Eye className="h-4 w-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <dl className="max-h-[420px] space-y-3 overflow-y-auto">
          {fields.map((f) => (
            <div key={f.label} className="grid grid-cols-[96px_1fr] gap-3">
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd className={f.mono ? 'break-all font-mono text-xs' : 'break-all text-sm'}>{f.value}</dd>
            </div>
          ))}
        </dl>
        <DialogFooter />
      </DialogContent>
    </Dialog>
  );
}
