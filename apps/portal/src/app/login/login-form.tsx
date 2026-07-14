'use client';

import { useState } from 'react';
import { ShieldCheck, AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClientLogger } from '@/lib/logger-client';

const log = createClientLogger('LoginForm');

interface LoginFormProps {
  /** authorize 端点下发的不透明会话 ID（OAuth 标准链路）；为空表示无 OAuth 上下文 */
  sessionId?: string;
  initialError?: string | null;
}

export default function LoginForm({ sessionId, initialError }: LoginFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [formData, setFormData] = useState({ email: '', password: '' });

  const getErrorMessage = (err: string | null) => {
    if (!err) return null;
    switch (err) {
      case 'token_exchange_failed':
        return '登录令牌交换失败，请联系管理员。';
      case 'invalid_state':
      case 'csrf_mismatch':
        return '登录状态校验失败，请刷新重试。';
      case 'nonce_mismatch':
        return '登录凭证校验失败，请刷新重试。';
      case 'session_expired':
        return '会话已过期，请重新登录。';
      case 'access_denied':
        return '访问被拒绝，权限不足。';
      default:
        return err;
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const body: Record<string, string> = { email: formData.email, password: formData.password };
      if (sessionId) body.session_id = sessionId;

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || '登录失败，请检查账号和密码');
      }

      // 登录成功：login_session 已由 Set-Cookie 写入浏览器（HttpOnly，JS 不可读但已存储）
      // - 有 redirect（OAuth 标准链路）→ 导航到 authorize，浏览器自动携带 login_session
      // - 无 redirect → 默认跳后台（页面侧由后续导航触发完整 OAuth 流程）
      if (data.redirect) {
        window.location.href = data.redirect;
      } else {
        window.location.href = '/dashboard';
      }
    } catch (err) {
      const error = err as Error;
      log.error('登录失败', { message: error.message });
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const formattedError = getErrorMessage(error);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-[var(--color-gradient-start)] to-[var(--color-gradient-end)] p-4 transition-colors">
      <div className="mb-8 flex flex-col items-center gap-2 animate-in fade-in slide-in-from-bottom-4 duration-700 text-white">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
          <ShieldCheck className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Auth-SSO Portal</h1>
      </div>

      <Card className="w-full max-w-[400px] border-none shadow-2xl ring-1 ring-border/50 overflow-hidden animate-in fade-in zoom-in-95 duration-500">
        <CardHeader className="space-y-1 text-center bg-slate-50/50 dark:bg-slate-900/50 border-b py-6">
          <CardTitle className="text-2xl">企业统一身份认证</CardTitle>
          <CardDescription>
            {sessionId ? '正在完成 OAuth 授权登录' : '使用您的企业账号登录管理门户'}
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="pt-6 space-y-4">
            {formattedError ? (
              <Alert variant="destructive" className="animate-in head-shake duration-300">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>登录遇到问题</AlertTitle>
                <AlertDescription>{formattedError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="email">账号 (邮箱)</Label>
              <Input
                id="email"
                type="text"
                placeholder="admin@example.com"
                required
                value={formData.email}
                onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
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
                onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
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

      <div className="mt-8 flex gap-4 text-sm text-muted-foreground">
        <Link href="/help" className="hover:text-primary underline-offset-4 hover:underline">
          帮助中心
        </Link>
        <span>&bull;</span>
        <Link href="/privacy" className="hover:text-primary underline-offset-4 hover:underline">
          隐私政策
        </Link>
      </div>
    </div>
  );
}
