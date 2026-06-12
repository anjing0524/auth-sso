import { NextRequest, NextResponse } from 'next/server';

/**
 * 不需要认证即可访问的路径前缀（白名单）
 */
const PUBLIC_PATHS = [
  '/login',
  '/oauth',
];

/**
 * 静态资源和 Next.js 内部路径前缀（直接放行）
 */
const SKIP_PREFIXES = [
  '/_next',
  '/favicon',
  '/images',
  '/fonts',
];

/**
 * 判断路径是否为公开可访问
 */
function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(prefix => pathname.startsWith(prefix));
}

/**
 * 判断路径是否为静态资源或内部路径
 */
function isSkipPath(pathname: string): boolean {
  if (pathname === '/') return true;
  return SKIP_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

/**
 * Next.js 16+ Proxy 路由守卫：网络边界拦截器
 * 统一验证 Better Auth 的本地 session_token 或 legacy portal_jwt_token cookie
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 白名单路径直接放行
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // 静态资源和内部路径直接放行
  if (isSkipPath(pathname)) {
    return NextResponse.next();
  }

  // API 路由放行，由 API 层 (auth-middleware) 自行进行数据库/细粒度鉴权
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // 检查 Better Auth Session Cookie 或旧有 JWT Cookie 是否存在
  const sessionToken = request.cookies.get('better-auth.session_token');
  const jwtToken = request.cookies.get('portal_jwt_token');

  if (!sessionToken?.value && !jwtToken?.value) {
    // 未登录：重定向到登录页，并携带当前访问路径作为 callbackUrl 引导回弹
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 放行
  return NextResponse.next();
}

/**
 * 路由匹配配置：避免在静态资源上执行中间代理
 */
export const config = {
  matcher: [
    '/((?!_next|favicon\\.ico|images|fonts).*)',
  ],
};
