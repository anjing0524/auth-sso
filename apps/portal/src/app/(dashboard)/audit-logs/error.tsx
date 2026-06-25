'use client';

/**
 * 审计日志页错误边界 (Error Boundary)
 *
 * 捕获审计日志数据获取过程中的未处理异常。
 *
 * @module app/(dashboard)/audit-logs/error
 */
import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AuditLogsError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error('[AuditLogs Error Boundary]', error);
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-8">
      <Card className="max-w-md w-full border-none shadow-sm ring-1 ring-border/50 rounded-2xl overflow-hidden text-center">
        <CardHeader className="pb-2 pt-8">
          <div className="mx-auto p-3 bg-amber-50 rounded-2xl w-fit mb-4">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
          </div>
          <CardTitle className="text-xl font-black">审计日志加载失败</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pb-8">
          <p className="text-sm text-muted-foreground">
            获取审计日志时遇到问题，请稍后重试。
          </p>
          {error.digest && (
            <code className="text-[10px] font-mono bg-slate-100 px-2 py-1 rounded text-slate-500">
              Error ID: {error.digest}
            </code>
          )}
          <Button
            onClick={reset}
            className="rounded-xl px-6 shadow-lg shadow-primary/20"
          >
            <RefreshCw className="mr-2 h-4 w-4" /> 重试
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
