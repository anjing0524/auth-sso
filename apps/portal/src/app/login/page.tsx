/**
 * Portal 登录页面
 * 提供登录入口，重定向到 IdP 进行认证
 */
import { Suspense } from 'react';
import LoginContent from './login-content';

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-pulse text-gray-400">加载中...</div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}