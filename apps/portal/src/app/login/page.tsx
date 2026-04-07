/**
 * Portal 登录页面
 * 提供登录入口，重定向到 IdP 进行认证
 */
import Link from 'next/link';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        {/* Header */}
        <div>
          <h1 className="mt-6 text-center text-3xl font-bold tracking-tight text-gray-900">
            Auth-SSO Portal
          </h1>
          <p className="mt-2 text-center text-sm text-gray-600">
            统一身份认证管理门户
          </p>
        </div>

        {/* 登录卡片 */}
        <div className="mt-8 space-y-6">
          <div className="rounded-lg bg-white px-6 py-8 shadow-md">
            <p className="text-center text-gray-600 mb-6">
              点击下方按钮登录，将跳转到统一身份认证平台进行认证
            </p>

            <a
              href="/api/auth/login"
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              使用统一身份登录
            </a>
          </div>

          {/* 说明 */}
          <div className="text-center text-xs text-gray-500">
            <p>首次登录将自动创建账户</p>
            <p className="mt-1">支持 OpenID Connect 标准协议</p>
          </div>
        </div>
      </div>
    </div>
  );
}