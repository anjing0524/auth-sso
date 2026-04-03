/**
 * 登录表单客户端组件
 * 使用原生 fetch 避免客户端库可能的干扰
 */
'use client';

import { useState } from 'react';

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
      console.log('[SignIn] POST to /api/auth/sign-in/email');
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // 核心修复：如果接口报错（如密码错误），将错误显示在页面上并中断
        const errorMsg = data.message || data.error?.message || '登录失败，请检查账号密码';
        throw new Error(errorMsg);
      }

      console.log('[SignIn] Login success, data:', data);

      // 登录成功，重定向
      // 无论有没有参数，都尝试去调用 authorize 端点，它会自动处理已登录状态
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
        
        console.log('[SignIn] Redirecting to OIDC:', authUrl.toString());
        window.location.href = authUrl.toString();
      } else if (redirectUrl && redirectUrl !== '/') {
        window.location.href = redirectUrl;
      } else {
        window.location.href = '/';
      }
    } catch (err) {
      const error = err as Error;
      console.error('[SignIn] Catch error:', error);
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
      {error && (
        <div className="rounded-md bg-red-50 p-4">
          <div className="text-sm text-red-700">{error}</div>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700">邮箱地址</label>
          <input
            id="email"
            name="email"
            type="text"
            required
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            placeholder="请输入邮箱或用户名"
            disabled={isLoading}
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700">密码</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            placeholder="请输入密码"
            disabled={isLoading}
          />
        </div>
      </div>

      <div>
        <button
          type="submit"
          disabled={isLoading}
          className="group relative flex w-full justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isLoading ? '登录中...' : '登录'}
        </button>
      </div>

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
