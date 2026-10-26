'use client';

import { useState } from 'react';
import { ShieldCheck, AlertCircle, Loader2, ArrowRight, Eye, EyeOff } from 'lucide-react';
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
import { LoginBackground } from './login-background';
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
  const [showPassword, setShowPassword] = useState(false);

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
      // 网关 OAuth 回调把授权端拒绝统一折叠成 oauth_denied（不再透传 error_description），
      // 这里给出可执行提示，避免用户只看到一行英文码（2026-10-21 实测：角色被删后登录仅显示 oauth_denied）。
      case 'oauth_denied':
        return '登录被拒绝：你的账号没有访问该系统的有效角色或权限，请联系管理员分配。';
      case 'no_roles':
        return '你的账号尚未分配任何有效角色，无法访问系统，请联系管理员。';
      case 'user_inactive':
        return '账号已被禁用或锁定，请联系管理员。';
      case 'unauthorized_client':
        return '你的角色未被授权访问该应用，请联系管理员。';
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
      if (!response.ok) {
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
    <div className="relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden bg-[#04122B] px-4 py-5">
      <LoginBackground />
      <div className="relative z-10 flex w-full flex-col items-center">
      <div className="mb-3 flex flex-col items-center gap-1 text-white">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/20">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight text-white">Auth-SSO Portal</h1>
      </div>

      <Card className="w-full max-w-[400px] overflow-hidden border-none shadow-2xl shadow-black/40 ring-1 ring-white/20">
        <CardHeader className="space-y-0.5 border-b bg-muted/30 py-4 text-center">
          <CardTitle className="text-xl">企业统一身份认证</CardTitle>
          <CardDescription>
            {sessionId ? '正在完成 OAuth 授权登录' : '使用您的企业账号登录管理门户'}
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-3 pt-4">
            {formattedError ? (
              <Alert variant="destructive" className="animate-in head-shake duration-300">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>登录遇到问题</AlertTitle>
                <AlertDescription>{formattedError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="email">登录邮箱</Label>
              <Input
                id="email"
                type="text"
                autoComplete="username"
                placeholder="you@company.com"
                required
                value={formData.email}
                onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                disabled={isLoading}
                className="h-10"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  required
                  value={formData.password}
                  onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                  disabled={isLoading}
                  className="h-10 pr-10"
                />
                <button
                  type="button"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  title={showPassword ? '隐藏密码' : '显示密码'}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </CardContent>

          <CardFooter className="mt-6 flex flex-col gap-4 border-t bg-muted/30 py-4">
            <Button
              type="submit"
              className="h-10 w-full text-sm font-medium transition-all"
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
              <p className="font-mono opacity-60">OAuth 2.1 · OpenID Connect 1.0</p>
            </div>
          </CardFooter>
        </form>
      </Card>

      <p className="mt-4 text-xs text-white/45">
        登录遇到问题请联系企业 IT 管理员
      </p>
      </div>
    </div>
  );
}
