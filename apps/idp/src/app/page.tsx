/**
 * IdP 首页
 * 展示系统信息和受信任应用入口
 */
import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <span className="text-xl font-bold text-gray-900">Auth-SSO IdP</span>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                href="/sign-in"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
              >
                登录
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="flex-1 flex items-center justify-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl font-extrabold text-gray-900 sm:text-5xl md:text-6xl">
            Auth-SSO <span className="text-blue-600">身份认证平台</span>
          </h1>
          <p className="mt-3 max-w-md mx-auto text-base text-gray-500 sm:text-lg md:mt-5 md:text-xl md:max-w-3xl">
            提供安全、可靠、标准化的企业级统一身份认证服务。
            支持 OIDC/OAuth 2.1 协议，为您的应用提供单点登录能力。
          </p>

          <div className="mt-10 flex justify-center gap-6">
            <div className="bg-white p-6 rounded-xl shadow-md border border-gray-100 flex flex-col items-center w-64">
              <div className="text-3xl mb-4">🔐</div>
              <h3 className="text-lg font-bold text-gray-900">安全可靠</h3>
              <p className="mt-2 text-sm text-gray-500 text-center">
                基于现代加密技术，保护您的账户安全。
              </p>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-md border border-gray-100 flex flex-col items-center w-64">
              <div className="text-3xl mb-4">🌐</div>
              <h3 className="text-lg font-bold text-gray-900">标准协议</h3>
              <p className="mt-2 text-sm text-gray-500 text-center">
                支持 OpenID Connect 标准，轻松集成。
              </p>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-md border border-gray-100 flex flex-col items-center w-64">
              <div className="text-3xl mb-4">🚀</div>
              <h3 className="text-lg font-bold text-gray-900">一键登录</h3>
              <p className="mt-2 text-sm text-gray-500 text-center">
                多应用单点登录，提升工作效率。
              </p>
            </div>
          </div>

          <div className="mt-12">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              受信任的管理应用
            </h3>
            <div className="mt-4 flex justify-center">
              <a
                href="http://localhost:4002"
                className="flex items-center px-6 py-3 rounded-full bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
              >
                <span className="mr-2">⚡</span>
                管理门户 (Portal)
              </a>
            </div>
          </div>
        </div>
      </main>

      <footer className="bg-white border-t border-gray-200 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-gray-400 text-sm">
          <p>© 2026 Auth-SSO Project. Built with Security First.</p>
        </div>
      </footer>
    </div>
  );
}
