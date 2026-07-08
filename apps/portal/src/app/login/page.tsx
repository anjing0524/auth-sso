/**
 * Portal 登录页面
 *
 * 纯 JWT Cookie 认证——已移除 Better Auth getSession 回退。
 * 通过检查 portal_jwt_token Cookie 的 JWT 有效性来判断登录状态。
 *
 * 新链路：/login 只接收 session_id（OAuth 参数已暂存 Redis）。已登录时接续 authorize。
 */
import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAccessToken } from '@/lib/auth/token';
import { COOKIE_NAMES } from '@auth-sso/contracts';
import LoginForm from './login-form';


interface SearchParams {
  searchParams: Promise<{
    session_id?: string;
    error?: string;
  }>;
}

/**
 * 登录页面内容组件，处理参数解析、Cookies 校验以及自动重定向逻辑。
 * 包含获取身份（cookies/headers 等动态操作）的异步逻辑。
 */
async function LoginContent({ searchParams }: SearchParams) {
  const params = await searchParams;
  const sessionId = params.session_id;

  // 检查 JWT Cookie 是否有效（已登录用户的 SSO 免登）
  const cookieStore = await cookies();
  const jwtCookie = cookieStore.get(COOKIE_NAMES.JWT);

  if (jwtCookie?.value) {
    const claims = await verifyAccessToken(jwtCookie.value);
    if (claims) {
      if (sessionId) {
        // 已登录 + 授权请求 → 接续 authorize（SSO 免登，authorize 凭 session_id 恢复参数并签发 code）
        redirect(`/api/auth/oauth2/authorize?session_id=${sessionId}`);
      }
      redirect('/dashboard');
    }
  }

  return <LoginForm sessionId={sessionId} initialError={params.error || null} />;
}

/**
 * Portal 登录页面入口。
 * 使用 Suspense 包装动态内容组件，防止编译期静态生成因 cookies()/searchParams 报错。
 */
export default function LoginPage({ searchParams }: SearchParams) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
          <div className="animate-pulse text-gray-400">安全认证加载中...</div>
        </div>
      }
    >
      <LoginContent searchParams={searchParams} />
    </Suspense>
  );
}
