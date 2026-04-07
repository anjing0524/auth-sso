/**
 * Demo App 首页
 * 演示 SSO 登录流程
 */
import { cookies } from 'next/headers';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('demo_session');

  let user = null;
  if (sessionCookie) {
    try {
      const session = JSON.parse(sessionCookie.value);
      if (Date.now() < session.expiresAt) {
        user = session;
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50">
      <div className="max-w-4xl mx-auto px-4 py-16">
        {/* Header */}
        <header className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Demo App - SSO 测试
          </h1>
          <p className="text-lg text-gray-600">
            这是一个演示子应用，用于验证 SSO 接入功能
          </p>
        </header>

        {/* Main Card */}
        <main className="bg-white rounded-2xl shadow-xl p-8">
          {user ? (
            // 已登录状态
            <div className="space-y-6">
              <div className="flex items-center gap-4 p-4 bg-green-50 rounded-lg border border-green-200">
                <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">已登录</h2>
                  <p className="text-gray-600">SSO 认证成功</p>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">用户信息</h3>
                <dl className="space-y-3">
                  <div className="flex justify-between">
                    <dt className="text-gray-500">用户 ID</dt>
                    <dd className="text-gray-900 font-mono">{user.userId}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">邮箱</dt>
                    <dd className="text-gray-900">{user.email}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">姓名</dt>
                    <dd className="text-gray-900">{user.name}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">过期时间</dt>
                    <dd className="text-gray-900">{new Date(user.expiresAt).toLocaleString()}</dd>
                  </div>
                </dl>
              </div>

              <div className="flex gap-4">
                <a
                  href="/api/auth/logout"
                  className="flex-1 inline-flex items-center justify-center px-4 py-3 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors"
                >
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  登出
                </a>
                <a
                  href={process.env.NEXT_PUBLIC_PORTAL_URL || "http://localhost:4000"}
                  className="flex-1 inline-flex items-center justify-center px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                  返回 Portal
                </a>
              </div>
            </div>
          ) : (
            // 未登录状态
            <div className="space-y-6">
              <div className="flex items-center gap-4 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                <svg className="w-8 h-8 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">未登录</h2>
                  <p className="text-gray-600">请登录以访问完整功能</p>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">SSO 测试说明</h3>
                <ol className="list-decimal list-inside space-y-2 text-gray-600">
                  <li>点击下方"SSO 登录"按钮</li>
                  <li>如果已在 Portal 登录，将自动跳回并完成认证（SSO）</li>
                  <li>如果未在 Portal 登录，将跳转到 IdP 登录页</li>
                  <li>登录成功后自动返回此页面</li>
                </ol>
              </div>

              <div className="flex gap-4">
                <a
                  href="/api/auth/login"
                  className="flex-1 inline-flex items-center justify-center px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                >
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                  </svg>
                  SSO 登录
                </a>
                <a
                  href={process.env.NEXT_PUBLIC_PORTAL_URL || "http://localhost:4000"}
                  className="flex-1 inline-flex items-center justify-center px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                  前往 Portal
                </a>
              </div>
            </div>
          )}
        </main>

        {/* Info Section */}
        <section className="mt-12 grid md:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">OAuth 2.1</h3>
            <p className="text-gray-600 text-sm">
              使用标准 Authorization Code Flow with PKCE 进行认证
            </p>
          </div>
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">OIDC</h3>
            <p className="text-gray-600 text-sm">
              支持 OpenID Connect，获取用户身份信息
            </p>
          </div>
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">SSO</h3>
            <p className="text-gray-600 text-sm">
              已登录 IdP 的用户可自动完成认证，无需重新登录
            </p>
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-16 text-center text-gray-500 text-sm">
          <p>Demo App - SSO 测试应用</p>
          <p className="mt-1">运行在 {process.env.APP_URL || "http://localhost:4002"}</p>
        </footer>
      </div>
    </div>
  );
}