'use client';

/**
 * 通用“复制文本”图标按钮。
 *
 * 只负责剪贴板写入与 1.5s 成功态；调用方提供可访问名称与要复制的文本。
 * 失败时给出明确提示，不静默失败。
 */
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

interface CopyTextButtonProps {
  text: string;
  /** 可访问名称，例如「复制日志 ID」 */
  label: string;
  /** 成功提示文案，默认「已复制」 */
  successMessage?: string;
  disabled?: boolean;
}

export function CopyTextButton({ text, label, successMessage = '已复制', disabled = false }: CopyTextButtonProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(successMessage);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('复制失败，请手动选择');
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? '已复制' : label}
      title={copied ? '已复制' : label}
      disabled={disabled}
      onClick={copy}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}
