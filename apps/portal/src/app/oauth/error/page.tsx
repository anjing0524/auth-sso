'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { ShieldAlert, ArrowLeft, Home } from 'lucide-react';

function ErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  const message = searchParams.get('message') || '发生了一个错误，请稍后再试。';
  const clientId = searchParams.get('client_id');

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
            {error === 'unauthorized_client' ? '该账户无权访问目标系统' : '授权流程中断'}
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
          </div>
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
            如果您认为这是一个权限配置错误，请通过内部飞书/企业微信联系 <span className="text-foreground font-bold">@IT 系统管理员</span> 进行应用授权。
          </p>
        </div>
      </div>
    </main>
  );
}

export default function ErrorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center font-semibold text-muted-foreground/30 animate-pulse text-4xl italic">AUTH-SSO</div>}>
      <ErrorContent />
    </Suspense>
  );
}
