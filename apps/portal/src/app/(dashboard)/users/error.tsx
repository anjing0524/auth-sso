'use client';

/**
 * 用户管理错误边界 (Error Boundary)
 */

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createClientLogger } from '@/lib/logger-client';

const log = createClientLogger('UsersErrorBoundary');

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function UsersError({ error, reset }: ErrorProps) {
  useEffect(() => {
    log.error('用户页面渲染错误', { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-8">
      <Card className="max-w-md w-full border-none shadow-sm ring-1 ring-border/50 rounded-2xl overflow-hidden text-center">
        <CardHeader className="pb-2 pt-8">
          <div className="mx-auto p-3 bg-warning/10 rounded-2xl w-fit mb-4">
            <AlertTriangle className="h-8 w-8 text-warning" />
          </div>
          <CardTitle className="text-xl font-black">用户数据加载失败</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pb-8">
          <p className="text-sm text-muted-foreground">
            获取用户列表时遇到问题，请稍后重试。
          </p>
          {error.digest && (
            <code className="text-[10px] font-mono bg-muted px-2 py-1 rounded text-muted-foreground">
              Error ID: {error.digest}
            </code>
          )}
          <Button onClick={reset} className="rounded-lg px-6 shadow-lg shadow-primary/20">
            <RefreshCw className="mr-2 h-4 w-4" /> 重试
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
