/**
 * OAuth 访问受限错误页（PM-03 修复版）
 *
 * Server Component + searchParams（Next 16：Promise 形态），不新增 API 路由。
 * 变更要点：
 * - 按错误码给出针对性自助指引（`./error-guidance`，纯函数 + 测试）
 * - 移除「内部飞书/企业微信联系 @IT」租户内部文案，改中性表述
 * - 展示可复制错误码与发生时间，供排障对账
 */
import { Suspense } from 'react';
import Link from 'next/link';
import { ShieldAlert, ArrowLeft, Home, Clock } from 'lucide-react';
import { CopyTextButton } from '@/components/shared/copy-text-button';
import { resolveErrorGuidance } from './error-guidance';

/**
 * 该路由读取 searchParams 动态数据，保留服务端阻塞（Cache Components 的 instant 导航校验）。
 */
export const instant = false;

interface ErrorPageProps {
  searchParams: Promise<{
    error?: string;
    message?: string;
    client_id?: string;
  }>;
}

/** 发生时间格式：YYYY-MM-DD HH:mm:ss（服务端本地时区渲染一次，供排障对账） */
function formatOccurredAt(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

async function ErrorContent({ searchParams }: ErrorPageProps) {
  const params = await searchParams;
  const errorCode = params.error || null;
  const message = params.message || '发生了一个错误，请稍后再试。';
  const clientId = params.client_id;
  const guidance = resolveErrorGuidance(errorCode);
  const occurredAt = formatOccurredAt(new Date());

  return (
    <main className="min-h-screen flex items-center justify-center bg-muted py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-md w-full space-y-8 bg-card p-10 rounded-xl shadow-2xl shadow-muted-foreground/10 border border-border relative overflow-hidden">
        {/* Brand Header */}
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-primary to-primary-hover" />

        <div className="text-center">
          <div className="inline-flex items-center justify-center h-20 w-20 rounded-xl bg-destructive/10 text-destructive mb-6 ring-8 ring-destructive/5">
            <ShieldAlert className="h-10 w-10" />
          </div>
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="h-6 w-6 bg-primary rounded-lg flex items-center justify-center shadow-lg shadow-primary/20">
               <span className="text-[10px] text-primary-foreground font-semibold">A</span>
            </div>
            <span className="text-sm font-semibold tracking-tighter text-foreground">Auth-SSO <span className="text-link">Identity</span></span>
          </div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">
            访问受限
          </h1>
          <p className="mt-2 text-sm font-medium text-muted-foreground">
            {guidance.summary}
          </p>
        </div>

        <div className="bg-muted rounded-xl p-6 border border-border">
          <div className="flex flex-col gap-3">
            <p role="alert" className="break-words text-sm font-bold text-foreground/80 leading-relaxed text-center">
              {message}
            </p>
            {clientId && (
              <div className="flex items-center justify-center gap-2">
                <span className="text-[10px] font-semibold text-muted-foreground tracking-widest text-center">目标应用：</span>
                <code className="break-all text-[11px] bg-card px-2 py-0.5 rounded border border-border text-link font-mono font-bold shadow-sm">
                  {clientId}
                </code>
              </div>
            )}
            {errorCode && (
              <div className="flex items-center justify-center gap-1.5">
                <code className="break-all text-[11px] bg-card px-2 py-0.5 rounded border border-border text-foreground/80 font-mono font-semibold shadow-sm">
                  {errorCode}
                </code>
                <CopyTextButton text={errorCode} label="复制错误码" successMessage="错误码已复制" />
              </div>
            )}
            <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" aria-hidden="true" />
              发生时间：{occurredAt}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-[13px] font-medium text-foreground/80">你可以尝试：</p>
          <ol className="list-decimal list-inside space-y-1.5 text-[13px] leading-6 text-muted-foreground">
            {guidance.selfHelp.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>

        <div className="flex flex-col gap-3">
          <Link
            href="/login"
            className="group w-full flex items-center justify-center py-3 px-4 border border-transparent text-sm font-bold rounded-lg text-primary-foreground bg-primary hover:bg-primary-hover focus:outline-none focus:ring-4 focus:ring-primary/20 transition-all duration-200 shadow-lg shadow-primary/20"
          >
            <ArrowLeft className="mr-2 h-4 w-4 transition-transform group-hover:-translate-x-1" />
            切换账号登录
          </Link>
          <Link
            href="/"
            className="group w-full flex items-center justify-center py-3 px-4 border border-border text-sm font-bold rounded-lg text-foreground/80 bg-card hover:bg-muted hover:border-border focus:outline-none focus:ring-4 focus:ring-muted transition-all duration-200"
          >
            <Home className="mr-2 h-4 w-4" />
            返回平台首页
          </Link>
        </div>

        <div className="pt-4 border-t border-border text-center">
          <p className="text-[11px] text-muted-foreground font-medium leading-relaxed">
            如以上步骤未能解决，请联系系统管理员，并提供上方错误码与发生时间，以便快速定位。
          </p>
        </div>
      </div>
    </main>
  );
}

export default function ErrorPage({ searchParams }: ErrorPageProps) {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center font-semibold text-muted-foreground/30 animate-pulse text-4xl italic">AUTH-SSO</div>}>
      <ErrorContent searchParams={searchParams} />
    </Suspense>
  );
}
