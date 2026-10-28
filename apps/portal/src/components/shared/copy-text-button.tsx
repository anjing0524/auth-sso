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
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      // 非安全上下文/iframe/权限被拒时回退；只有真的成功才提示
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      copied = document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    if (!copied) {
      toast.error('复制失败，请手动选择');
      return;
    }
    setCopied(true);
    toast.success(successMessage);
    setTimeout(() => setCopied(false), 1500);
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
