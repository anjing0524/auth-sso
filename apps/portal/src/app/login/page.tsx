/**
 * Portal 登录页面
 *
 * 纯 JWT Cookie 认证——已移除 Better Auth getSession 回退。
 * 通过检查 portal_jwt_token Cookie 的 JWT 有效性来判断登录状态。
 */
import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAppBaseURL } from '@/lib/env';
import { verifyAccessToken } from '@/lib/auth/token';
import { COOKIE_NAMES } from '@auth-sso/contracts';
import LoginForm from './login-form';

interface SearchParams {
  searchParams: Promise<{
    redirect_url?: string;
    redirect_uri?: string;
    client_id?: string;
    scope?: string;
    state?: string;
    code_challenge?: string;
    code_challenge_method?: string;
    response_type?: string;
    nonce?: string;
    callbackUrl?: string;
    redirect?: string;
    error?: string;
    status?: string;
  }>;
}

export default async function LoginPage({ searchParams }: SearchParams) {
  const params = await searchParams;

  const redirectUrl =
    params.redirect_url || params.redirect_uri || params.callbackUrl || params.redirect || '/dashboard';
  const clientId = params.client_id;
  const scope = params.scope;
  const state = params.state;
  const codeChallenge = params.code_challenge;
  const codeChallengeMethod = params.code_challenge_method;
  const responseType = params.response_type;
  const nonce = params.nonce;

  // 检查 JWT Cookie 是否有效
  const cookieStore = await cookies();
  const jwtCookie = cookieStore.get(COOKIE_NAMES.JWT);

  if (jwtCookie?.value) {
    const claims = await verifyAccessToken(jwtCookie.value);

    if (claims) {
      // 已登录 + 有 OAuth 参数 → 直接跳转到授权端点
      if (clientId) {
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

      // 已登录无 OAuth 参数 → 进入管理后台
      redirect(redirectUrl === '/' ? '/dashboard' : redirectUrl);
    }
  }

  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
          <div className="animate-pulse text-gray-400">安全认证加载中...</div>
        </div>
      }
    >
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
