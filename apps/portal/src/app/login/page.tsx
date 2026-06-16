/**
 * Portal 登录页面 (已合并 IDP)
 * 处理用户本地认证与单点登录授权参数传递
 */
import { Suspense } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/infrastructure/auth/auth-instance';
import { getAppBaseURL } from '@/lib/env';
import LoginForm from './login-form';

interface SearchParams {
  searchParams: Promise<{
    // 支持 Better Auth 认证或 OIDC 流程参数
    redirect_url?: string;
    redirect_uri?: string;
    client_id?: string;
    scope?: string;
    state?: string;
    code_challenge?: string;
    code_challenge_method?: string;
    response_type?: string;
    nonce?: string;
    
    // Portal 原本的 callbackUrl 参数
    callbackUrl?: string;
    redirect?: string;
    error?: string;
    status?: string;
  }>;
}

export default async function LoginPage({ searchParams }: SearchParams) {
  const params = await searchParams;
  
  // 提取重定向地址：优先使用 OIDC 参数，其次是 callbackUrl，最后是 dashboard 首页
  const redirectUrl = params.redirect_url || params.redirect_uri || params.callbackUrl || params.redirect || '/dashboard';
  const clientId = params.client_id;
  const scope = params.scope;
  const state = params.state;
  const codeChallenge = params.code_challenge;
  const codeChallengeMethod = params.code_challenge_method;
  const responseType = params.response_type;
  const nonce = params.nonce;

  // 1. 检查是否已经登录
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  // 2. 如果已登录，且有 OAuth 参数，直接跳转到授权端点触发授权码发放
  if (session && clientId) {
    const authUrl = new URL('/api/auth/oauth2/authorize', getAppBaseURL());
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUrl);
    authUrl.searchParams.set('response_type', responseType || 'code');
    if (scope) authUrl.searchParams.set('scope', scope);
    if (state) authUrl.searchParams.set('state', state);
    if (codeChallenge) authUrl.searchParams.set('code_challenge', codeChallenge);
    if (codeChallengeMethod) authUrl.searchParams.set('code_challenge_method', codeChallengeMethod);
    if (nonce) authUrl.searchParams.set('nonce', nonce);

    redirect(`${authUrl.pathname}${authUrl.search}`);
  }

  // 3. 如果已登录但没有 OAuth 参数，直接重定向回业务跳转页或管理后台首页
  if (session) {
    redirect(redirectUrl === '/' ? '/dashboard' : redirectUrl);
  }

  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="animate-pulse text-gray-400">安全认证加载中...</div>
      </div>
    }>
      <LoginForm
        redirectUrl={redirectUrl}
        clientId={clientId}
        scope={scope}
        state={state}
        codeChallenge={codeChallenge}
        codeChallengeMethod={codeChallengeMethod}
        responseType={responseType}
        nonce={nonce}
        initialError={params.error || null}
      />
    </Suspense>
  );
}