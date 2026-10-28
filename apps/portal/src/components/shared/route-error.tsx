'use client';

/**
 * 路由错误边界共享 UI：重试 / 返回工作台 / 复制错误 ID。
 *
 * 此前 6 个路由各自复制同一段错误卡（只有「重试」）：用户无法返回、无法把
 * Error ID 交给管理员；错误文案与样式也容易出现分叉。
 */
import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { createClientLogger } from '@/lib/logger-client';
import { CopyTextButton } from '@/components/shared/copy-text-button';

export interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  /** 每个路由的 logger 名称（保留原有分路由日志定位） */
  loggerName: string;
}

export function RouteError({ error, reset, loggerName }: RouteErrorProps) {
  useEffect(() => {
    createClientLogger(loggerName).error('路由渲染错误', {
      message: error.message,
      digest: error.digest,
    });
  }, [error, loggerName]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <Card className="w-full max-w-md overflow-hidden rounded-lg border border-border/70 text-center shadow-sm ring-0">
        <CardHeader className="pb-2 pt-6">
          <div className="mx-auto mb-4 w-fit rounded-xl bg-warning/10 p-3">
            <AlertTriangle className="h-8 w-8 text-warning" />
          </div>
          <h1 className="font-heading text-xl font-bold">页面加载出错</h1>
        </CardHeader>
        <CardContent className="space-y-4 pb-8">
          <p role="alert" className="text-sm text-muted-foreground">服务器在处理请求时遇到了问题，请稍后重试。</p>
          {error.digest && (
            <div className="flex items-center justify-center gap-1.5">
              <code className="rounded bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">
                错误 ID：{error.digest}
              </code>
              <CopyTextButton
                text={error.digest || `无错误 ID（${error.message.slice(0, 80)}）`}
                label="复制错误 ID"
                successMessage="错误 ID 已复制"
              />
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
