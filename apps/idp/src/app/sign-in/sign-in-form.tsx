/**
 * 登录表单客户端组件
 * 处理用户登录逻辑
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface SignInFormProps {
  redirectUrl: string;
  clientId?: string;
  scope?: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  responseType?: string;
  nonce?: string;
}

export default function SignInForm({
  redirectUrl,
  clientId,
  scope,
  state,
  codeChallenge,
  codeChallengeMethod,
  responseType,
  nonce,
}: SignInFormProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || '登录失败');
      }

      // 登录成功，重定向
      if (redirectUrl) {
        // 如果有 OAuth 参数，构建授权 URL
        // Better Auth OIDC Provider 端点路径: /api/auth/oauth2/authorize
        if (clientId) {
          const authUrl = new URL('/api/auth/oauth2/authorize', window.location.origin);
          authUrl.searchParams.set('client_id', clientId);
          authUrl.searchParams.set('redirect_uri', redirectUrl);
          authUrl.searchParams.set('response_type', responseType || 'code');
          if (scope) authUrl.searchParams.set('scope', scope);
          if (state) authUrl.searchParams.set('state', state);
          if (codeChallenge) authUrl.searchParams.set('code_challenge', codeChallenge);
          if (codeChallengeMethod) authUrl.searchParams.set('code_challenge_method', codeChallengeMethod);
          if (nonce) authUrl.searchParams.set('nonce', nonce);
          router.push(authUrl.toString());
        } else {
          router.push(redirectUrl);
        }
      } else {
        router.push('/');
      }
    } catch (err) {
      const error = err as Error;
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
      {/* 错误提示 */}
      {error && (
        <div className="rounded-md bg-red-50 p-4">
          <div className="text-sm text-red-700">{error}</div>
        </div>
      )}

      {/* 输入字段 */}
      <div className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700">
            邮箱地址
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
            placeholder="请输入邮箱"
            disabled={isLoading}
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700">
            密码
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
            placeholder="请输入密码"
            disabled={isLoading}
          />
        </div>
      </div>

      {/* 提交按钮 */}
      <div>
        <button
          type="submit"
          disabled={isLoading}
          className="group relative flex w-full justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? '登录中...' : '登录'}
        </button>
      </div>

      {/* OAuth 参数提示 */}
      {(clientId || scope) && (
        <div className="rounded-md bg-blue-50 p-4">
          <div className="text-sm text-blue-700">
            <p>授权应用: {clientId}</p>
            {scope && <p>权限范围: {scope}</p>}
          </div>
        </div>
      )}
    </form>
  );
}