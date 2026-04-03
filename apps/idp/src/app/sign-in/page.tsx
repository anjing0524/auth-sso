/**
 * IdP 登录页面
 * 处理用户认证和 OAuth 授权流程
 */
import { Suspense } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '../../lib/auth';
import SignInForm from './sign-in-form';

interface SearchParams {
  searchParams: Promise<{
    // Better Auth 传递的参数
    redirect_url?: string;
    redirect_uri?: string;  // OAuth redirect_uri
    client_id?: string;
    scope?: string;
    state?: string;
    code_challenge?: string;
    code_challenge_method?: string;
    response_type?: string;
    nonce?: string;
  }>;
}

export default async function SignInPage({ searchParams }: SearchParams) {
  const params = await searchParams;
  // 支持 redirect_url 和 redirect_uri 两种参数名
  const redirectUrl = params.redirect_url || params.redirect_uri || '/';
  const clientId = params.client_id;
  const scope = params.scope;
  const state = params.state;
  const codeChallenge = params.code_challenge;
  const codeChallengeMethod = params.code_challenge_method;
  const responseType = params.response_type;
  const nonce = params.nonce;

  // 检查是否已经登录
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  // 如果已登录，且有 OAuth 参数，直接去授权
  if (session && clientId) {
    const authUrl = new URL('/api/auth/oauth2/authorize', 'http://localhost:4001'); // 仅用于构造
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUrl);
    authUrl.searchParams.set('response_type', responseType || 'code');
    if (scope) authUrl.searchParams.set('scope', scope);
    if (state) authUrl.searchParams.set('state', state);
    if (codeChallenge) authUrl.searchParams.set('code_challenge', codeChallenge);
    if (codeChallengeMethod) authUrl.searchParams.set('code_challenge_method', codeChallengeMethod);
    if (nonce) authUrl.searchParams.set('nonce', nonce);

    // 在服务器端重定向到本地相对路径
    redirect(`${authUrl.pathname}${authUrl.search}`);
  }

  // 如果已登录但没有 OAuth 参数，重定向到首页或指定 URL
  if (session && redirectUrl && redirectUrl !== '/') {
    redirect(redirectUrl);
  } else if (session) {
    redirect('/');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        {/* Header */}
        <div>
          <h1 className="mt-6 text-center text-3xl font-bold tracking-tight text-gray-900">
            Auth-SSO 登录
          </h1>
          <p className="mt-2 text-center text-sm text-gray-600">
            统一身份认证平台
          </p>
        </div>

        {/* 登录表单 */}
        <Suspense fallback={<div className="text-center">加载中...</div>}>
          <SignInForm
            redirectUrl={redirectUrl}
            clientId={clientId}
            scope={scope}
            state={state}
            codeChallenge={codeChallenge}
            codeChallengeMethod={codeChallengeMethod}
            responseType={responseType}
            nonce={nonce}
          />
        </Suspense>
      </div>
    </div>
  );
}