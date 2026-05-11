'use client';

import { useSearchParams } from 'next/navigation';
import { ShieldCheck, AlertCircle, ArrowRight, Lock } from 'lucide-react';
import Link from 'next/link';

import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardFooter, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  const status = searchParams.get('status');

  const getErrorMessage = (err: string | null) => {
    switch (err) {
      case 'token_exchange_failed':
        return '登录令牌交换失败，请联系管理员。';
      case 'invalid_state':
        return '登录状态校验失败，请刷新重试。';
      case 'session_expired':
        return '会话已过期，请重新登录。';
      case 'access_denied':
        return '访问被拒绝，权限不足。';
      default:
        return err ? `认证失败: ${err}` : null;
    }
  };

  const errorMessage = getErrorMessage(error);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 p-4 transition-colors">
      {/* 品牌 Logo */}
      <div className="mb-8 flex flex-col items-center gap-2 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
          <ShieldCheck className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Auth-SSO Portal</h1>
      </div>

      <Card className="w-full max-w-[400px] border-none shadow-2xl ring-1 ring-border/50 overflow-hidden animate-in fade-in zoom-in-95 duration-500">
        <CardHeader className="space-y-1 text-center bg-slate-50/50 dark:bg-slate-900/50 border-b">
          <CardTitle className="text-2xl">欢迎登录</CardTitle>
          <CardDescription>
            使用您的企业账号访问管理门户
          </CardDescription>
        </CardHeader>
        
        <CardContent className="pt-8 space-y-6">
          {errorMessage && (
            <Alert variant="destructive" className="animate-in head-shake duration-300">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>错误 {status && `(${status})`}</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-4">
            <div className="rounded-lg bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/20 p-4 text-sm text-blue-700 dark:text-blue-400">
              <p className="flex gap-2">
                <Lock className="h-4 w-4 shrink-0" />
                即将跳转到统一身份认证中心 (IdP) 完成安全验证。
              </p>
            </div>

            <Button className="w-full h-12 text-md font-medium group transition-all" asChild>
              <a href="/api/auth/login">
                {error ? '重新尝试登录' : '使用统一身份登录'}
                <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </a>
            </Button>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col gap-4 border-t bg-slate-50/30 dark:bg-slate-900/20 py-4">
          <div className="text-center text-xs text-muted-foreground">
            <p>首次登录将根据 OIDC 协议自动配置您的账户</p>
            <p className="mt-1 font-mono opacity-60">OpenID Connect 2.1 Compliant</p>
          </div>
        </CardFooter>
      </Card>

      {/* 辅助链接 */}
      <div className="mt-8 flex gap-4 text-sm text-muted-foreground">
        <Link href="/help" className="hover:text-primary underline-offset-4 hover:underline">帮助中心</Link>
        <span>&bull;</span>
        <Link href="/privacy" className="hover:text-primary underline-offset-4 hover:underline">隐私政策</Link>
      </div>
    </div>
  );
}
