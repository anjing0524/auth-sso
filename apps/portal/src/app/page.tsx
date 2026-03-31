/**
 * Portal 首页
 * Auth-SSO 管理门户入口页面
 */
import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* 导航栏 */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <span className="text-xl font-bold text-gray-900">Auth-SSO Portal</span>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                href="/login"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
              >
                登录
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* 主内容区 */}
      <main className="flex-1 flex items-center justify-center">
        <div className="max-w-3xl mx-auto text-center px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold text-gray-900 sm:text-5xl md:text-6xl">
            统一身份认证
            <span className="text-blue-600">管理门户</span>
          </h1>
          <p className="mt-3 max-w-md mx-auto text-base text-gray-500 sm:text-lg md:mt-5 md:text-xl md:max-w-3xl">
            基于 OAuth 2.1 和 OpenID Connect 的企业级单点登录解决方案
          </p>

          <div className="mt-10 flex justify-center gap-4">
            <Link
              href="/login"
              className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 shadow-lg"
            >
              开始使用
              <svg className="ml-2 -mr-1 w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </Link>
            <a
              href="/api/me"
              className="inline-flex items-center px-6 py-3 border border-gray-300 text-base font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
            >
              查看用户信息
            </a>
          </div>

          {/* 功能介绍 */}
          <div className="mt-16 grid grid-cols-1 gap-8 sm:grid-cols-3">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-blue-600 text-3xl mb-4">🔐</div>
              <h3 className="text-lg font-medium text-gray-900">OAuth 2.1 认证</h3>
              <p className="mt-2 text-sm text-gray-500">
                支持 Authorization Code Flow with PKCE，提供企业级安全保障
              </p>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-blue-600 text-3xl mb-4">👤</div>
              <h3 className="text-lg font-medium text-gray-900">单点登录</h3>
              <p className="mt-2 text-sm text-gray-500">
                一次登录，多处使用，简化用户认证流程
              </p>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-blue-600 text-3xl mb-4">🛡️</div>
              <h3 className="text-lg font-medium text-gray-900">RBAC 权限</h3>
              <p className="mt-2 text-sm text-gray-500">
                细粒度的角色和权限管理，支持数据范围控制
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* 页脚 */}
      <footer className="bg-white border-t border-gray-200">
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          <p className="text-center text-sm text-gray-500">
            Auth-SSO - 企业级统一身份认证解决方案
          </p>
        </div>
      </footer>
    </div>
  );
}