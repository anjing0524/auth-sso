/**
 * IdP 登录页面
 * 处理用户认证和 OAuth 授权流程
 */
import { Suspense } from 'react';
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