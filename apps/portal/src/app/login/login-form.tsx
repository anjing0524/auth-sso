'use client';

import { useState } from 'react';
import { ShieldCheck, AlertCircle, Lock, Loader2, ArrowRight } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface LoginFormProps {
  redirectUrl: string;
  clientId?: string;
  scope?: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  responseType?: string;
  nonce?: string;
  initialError?: string | null;
}

export default function LoginForm({
  redirectUrl,
  clientId,
  scope,
  state,
  codeChallenge,
  codeChallengeMethod,
  responseType,
  nonce,
  initialError,
}: LoginFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  const getErrorMessage = (err: string | null) => {
    if (!err) return null;
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
        return err;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      console.log('[LoginForm] Submitting credentials to local /api/auth/sign-in/email');
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMsg = data.message || data.error?.message || '登录失败，请检查账号和密码';
        throw new Error(errorMsg);
      }

      console.log('[LoginForm] Sign-in successful!');

      // 登录成功后的路由重定向分流
      if (clientId) {
        // 说明是外部应用单点登录（OIDC）重定向过来的，登录成功后跳转到本地授权端点获取 code
        const authUrl = new URL('/api/auth/oauth2/authorize', window.location.origin);
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUrl);
        authUrl.searchParams.set('response_type', responseType || 'code');
        if (scope) authUrl.searchParams.set('scope', scope);
        if (state) authUrl.searchParams.set('state', state);
        if (codeChallenge) authUrl.searchParams.set('code_challenge', codeChallenge);
        if (codeChallengeMethod) authUrl.searchParams.set('code_challenge_method', codeChallengeMethod);
        if (nonce) authUrl.searchParams.set('nonce', nonce);
        
        window.location.href = authUrl.toString();
      } else {
        // 说明是 Portal 自身系统的登录，直接重定向回目标页或 dashboard
        window.location.href = redirectUrl === '/' ? '/dashboard' : redirectUrl;
      }
    } catch (err) {
      const error = err as Error;
      console.error('[LoginForm] Sign-in error:', error);
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const formattedError = getErrorMessage(error);

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
        <CardHeader className="space-y-1 text-center bg-slate-50/50 dark:bg-slate-900/50 border-b py-6">
          <CardTitle className="text-2xl">企业统一身份认证</CardTitle>
          <CardDescription>
            {clientId ? `正在授权访问系统: ${clientId}` : '使用您的企业账号登录管理门户'}
          </CardDescription>
        </CardHeader>
        
        <form onSubmit={handleSubmit} method="POST">
          <CardContent className="pt-6 space-y-4">
            {formattedError && (
              <Alert variant="destructive" className="animate-in head-shake duration-300">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>登录遇到问题</AlertTitle>
                <AlertDescription>{formattedError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">账号 (邮箱)</Label>
              <Input
                id="email"
                type="text"
                placeholder="admin@example.com"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                disabled={isLoading}
                className="h-10"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                required
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                disabled={isLoading}
                className="h-10"
              />
            </div>
          </CardContent>

          <CardFooter className="flex flex-col gap-4 border-t bg-slate-50/30 dark:bg-slate-900/20 py-4 mt-6">
            <Button 
              type="submit" 
              className="w-full h-11 text-md font-medium group transition-all" 
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  验证中...
                </>
              ) : (
                <>
                  安全登录
                  <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </Button>
            
            <div className="text-center text-xs text-muted-foreground w-full">
              <p className="font-mono opacity-60">OpenID Connect 2.1 Standard</p>
            </div>
          </CardFooter>
        </form>
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
