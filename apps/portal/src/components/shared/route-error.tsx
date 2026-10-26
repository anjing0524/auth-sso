'use client';

/**
 * 路由错误边界共享 UI：重试 / 返回工作台 / 复制 Error ID。
 *
 * 此前 6 个路由各自复制同一段错误卡（只有「重试」）：用户无法返回、无法把
 * Error ID 交给管理员；错误文案与样式也容易出现分叉。
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, Copy, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createClientLogger } from '@/lib/logger-client';

export interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  /** 每个路由的 logger 名称（保留原有分路由日志定位） */
  loggerName: string;
}

export function RouteError({ error, reset, loggerName }: RouteErrorProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    createClientLogger(loggerName).error('路由渲染错误', {
      message: error.message,
      digest: error.digest,
    });
  }, [error, loggerName]);

  const copyErrorId = async () => {
    const id = error.digest || `无 Error ID（${error.message.slice(0, 80)}）`;
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      toast.success('Error ID 已复制');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('复制失败，请手动选择');
    }
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <Card className="w-full max-w-md overflow-hidden rounded-lg border border-border/70 text-center shadow-sm ring-0">
        <CardHeader className="pb-2 pt-6">
          <div className="mx-auto mb-4 w-fit rounded-xl bg-warning/10 p-3">
            <AlertTriangle className="h-8 w-8 text-warning" />
          </div>
          <CardTitle className="text-xl font-bold">页面加载出错</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pb-8">
          <p className="text-sm text-muted-foreground">服务器在处理请求时遇到了问题，请稍后重试。</p>
          {error.digest && (
            <div className="flex items-center justify-center gap-1.5">
              <code className="rounded bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">
                Error ID: {error.digest}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="复制 Error ID"
                title="复制 Error ID"
                onClick={copyErrorId}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={reset}>
              <RefreshCw className="mr-2 h-4 w-4" /> 重试
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard">返回工作台</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
