'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ShieldCheck,
  AlertCircle,
  Loader2,
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  ScrollText,
} from 'lucide-react';
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

/** 左侧品牌区的固定能力说明：三条足以建立信任，不再堆营销文案。 */
const brandPoints = [
  {
    icon: KeyRound,
    title: '统一身份',
    description: '一次登录，访问全部已接入系统',
  },
  {
    icon: ShieldCheck,
    title: '细粒度权限',
    description: '角色、部门与数据范围统一治理',
  },
  {
    icon: ScrollText,
    title: '全链路审计',
    description: '登录、操作与访问记录可追溯',
  },
];

export default function LoginForm({ sessionId, initialError }: LoginFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const focusPasswordAfterError = useRef(false);

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
      // 失败后清空密码（降低偷窥/复用风险），保留邮箱并聚焦密码框（重试成本最低）
      setFormData((prev) => ({ ...prev, password: '' }));
      focusPasswordAfterError.current = true;
    } finally {
      setIsLoading(false);
    }
  };

  // 失败时在 loading 结束、输入框恢复可用后再聚焦密码框（disabled 时 focus 无效）
  useEffect(() => {
    if (!isLoading && error && focusPasswordAfterError.current) {
      focusPasswordAfterError.current = false;
      passwordRef.current?.focus();
    }
  }, [error, isLoading]);

  const formattedError = getErrorMessage(error);

  return (
    <main className="min-h-[100svh] bg-[#F4F7FB] lg:grid lg:grid-cols-[minmax(0,46%)_1fr]">
      {/* 品牌区：静态深色面板，不跑动画，不抢表单焦点 */}
      <aside className="relative hidden overflow-hidden bg-[#091A32] lg:flex lg:flex-col">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(255,255,255,0.055) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.055) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 top-[-12%] h-[520px] w-[520px] rounded-full bg-[#1D5BFF]/25 blur-[130px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-28 -left-20 h-[420px] w-[420px] rounded-full bg-[#0C9CB8]/15 blur-[110px]"
        />
        <ShieldCheck
          aria-hidden="true"
          strokeWidth={1}
          className="pointer-events-none absolute -right-16 bottom-8 h-80 w-80 text-white/[0.045]"
        />

        <div className="relative z-10 flex h-full flex-col p-8 xl:p-12">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <div className="leading-tight">
              <p className="text-[17px] font-semibold tracking-tight text-white">Auth-SSO</p>
              <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.2em] text-white/60">
                Identity OS
              </p>
            </div>
          </div>

          <div className="my-auto max-w-[420px] py-6 xl:py-10">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60">
              Identity & Access
            </p>
            <h2 className="mt-5 text-[32px] font-semibold leading-[1.28] tracking-tight text-white xl:text-[36px]">
              一个入口，
              <br />
              管理所有身份与权限。
            </h2>
            <p className="mt-5 max-w-[360px] text-sm leading-6 text-white/60">
              面向企业接入场景的统一身份认证、权限治理与审计追踪平台。
            </p>

            <ul className="mt-8 space-y-4">
              {brandPoints.map(({ icon: Icon, title, description }) => (
                <li key={title} className="flex items-start gap-3.5">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] ring-1 ring-white/10">
                    <Icon className="h-4 w-4 text-white/70" />
                  </span>
                  <span>
                    <span className="block text-[13px] font-medium text-white/85">{title}</span>
                    <span className="mt-1 block text-xs leading-5 text-white/60">{description}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-5 text-[11px] text-white/60">
            <span>© 2026 Auth-SSO</span>
            <span>身份与访问管理</span>
          </div>
        </div>
      </aside>

      {/* 登录区：浅色、无重卡片；把视觉焦点留给输入与主按钮 */}
      <section className="flex min-h-[100svh] flex-col px-6 py-4 lg:min-h-0 lg:px-14 xl:px-20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 lg:hidden">
            <ShieldCheck className="h-4 w-4 text-color-primary" />
            <span className="text-sm font-semibold">Auth-SSO</span>
          </div>
          <p className="ml-auto text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            企业统一身份认证
          </p>
        </div>

        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-4">
          <div className="mb-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-color-primary">
              Admin Console
            </p>
            <h1 className="mt-3 text-[30px] font-semibold leading-tight tracking-tight text-foreground">
              登录管理控制台
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {sessionId ? '正在完成 OAuth 授权登录，请验证企业账号。' : '使用企业账号继续访问。'}
            </p>
          </div>

          <form aria-label="登录表单" onSubmit={handleSubmit} className="space-y-4">
            {formattedError ? (
              <Alert variant="destructive" className="animate-in head-shake duration-300">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>登录遇到问题</AlertTitle>
                <AlertDescription>{formattedError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="login-email">登录邮箱</Label>
              <Input
                id="login-email"
                type="text"
                maxLength={255}
                autoComplete="username"
                placeholder="you@company.com"
                required
                value={formData.email}
                onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                disabled={isLoading}
                className="h-11 border-border/80 bg-white shadow-none"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="login-password">密码</Label>
              <div className="relative">
                <Input
                  ref={passwordRef}
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="请输入密码"
                  required
                  value={formData.password}
                  onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                  disabled={isLoading}
                  className="h-11 border-border/80 bg-white pr-11 shadow-none"
                />
                <button
                  type="button"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  aria-pressed={showPassword}
                  title={showPassword ? '隐藏密码' : '显示密码'}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[11px] leading-5 text-muted-foreground">
                忘记密码？请联系管理员重置（当前不支持自助找回）。
              </p>
            </div>

            <Button
              type="submit"
              className="group h-11 w-full text-sm font-medium shadow-sm"
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
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">
            登录遇到问题请联系企业 IT 管理员
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-4 text-[11px] text-muted-foreground">
          <span>OAuth 2.1 · OpenID Connect 1.0</span>
          <span>安全连接</span>
        </div>
      </section>
    </main>
  );
}
