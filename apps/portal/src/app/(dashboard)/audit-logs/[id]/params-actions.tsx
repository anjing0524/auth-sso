'use client';

/**
 * 审计参数取证：复制 JSON / 下载 .json。
 * 详情页是独立页面（非弹窗），不引入内部滚动。
 */
import { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

export function AuditParamsActions({ id, params }: { id: string; params: Record<string, unknown> | null }) {
  const [copied, setCopied] = useState(false);
  if (!params) return null;
  const text = JSON.stringify(params, null, 2);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('参数已复制');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('复制失败，请手动选择');
    }
  };

  const download = () => {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-params-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="ml-auto flex items-center gap-1.5">
      <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={copy} aria-label="复制变更参数">
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? '已复制' : '复制'}
      </Button>
      <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={download} aria-label="下载变更参数">
        <Download className="h-3.5 w-3.5" /> 下载
      </Button>
    </div>
  );
}
