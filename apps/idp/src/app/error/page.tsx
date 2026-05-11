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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-md w-full space-y-8 bg-white p-10 rounded-[2rem] shadow-2xl shadow-slate-200/50 border border-slate-100 relative overflow-hidden">
        {/* Brand Header */}
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-600 to-indigo-600" />
        
        <div className="text-center">
          <div className="inline-flex items-center justify-center h-20 w-20 rounded-3xl bg-red-50 text-red-600 mb-6 ring-8 ring-red-50/50">
            <ShieldAlert className="h-10 w-10" />
          </div>
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="h-6 w-6 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-200">
               <span className="text-[10px] text-white font-black">A</span>
            </div>
            <span className="text-sm font-black tracking-tighter text-slate-900 uppercase">Auth-SSO <span className="text-blue-600">Identity</span></span>
          </div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">
            访问受限
          </h2>
          <p className="mt-2 text-sm font-medium text-slate-500">
            {error === 'unauthorized_client' ? '该账户无权访问目标系统' : '授权流程中断'}
          </p>
        </div>
        
        <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
          <div className="flex flex-col gap-3">
            <p className="text-sm font-bold text-slate-700 leading-relaxed text-center">
              {message}
            </p>
            {clientId && (
              <div className="flex items-center justify-center gap-2">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest text-center">Target App:</span>
                <code className="text-[11px] bg-white px-2 py-0.5 rounded border border-slate-200 text-blue-600 font-mono font-bold shadow-sm">
                  {clientId}
                </code>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Link
            href="/sign-in"
            className="group w-full flex items-center justify-center py-3 px-4 border border-transparent text-sm font-bold rounded-xl text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all duration-200 shadow-lg shadow-blue-200"
          >
            <ArrowLeft className="mr-2 h-4 w-4 transition-transform group-hover:-translate-x-1" />
            切换账号登录
          </Link>
          <Link
            href="/"
            className="group w-full flex items-center justify-center py-3 px-4 border border-slate-200 text-sm font-bold rounded-xl text-slate-700 bg-white hover:bg-slate-50 hover:border-slate-300 focus:outline-none focus:ring-4 focus:ring-slate-100 transition-all duration-200"
          >
            <Home className="mr-2 h-4 w-4" />
            返回平台首页
          </Link>
        </div>
        
        <div className="pt-4 border-t border-slate-50 text-center">
          <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
            如果您认为这是一个权限配置错误，请通过内部飞书/企业微信联系 <span className="text-slate-900 font-bold">@IT 系统管理员</span> 进行应用授权。
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ErrorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center font-black text-slate-200 animate-pulse text-4xl italic">AUTH-SSO</div>}>
      <ErrorContent />
    </Suspense>
  );
}
