import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAMES } from '@auth-sso/contracts';

/**
 * 不需要认证即可访问的路径前缀（白名单）
 */
const PUBLIC_PATHS = [
  '/login',
  '/oauth2',
  '/.well-known',
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

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((prefix) => pathname.startsWith(prefix));
}

function isSkipPath(pathname: string): boolean {
  if (pathname === '/') return true;
  return SKIP_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Next.js Proxy 路由守卫：纯 JWT Cookie 认证
 *
 * 只检查 portal_jwt_token Cookie 是否存在。
 * 不验证 JWT 有效性——有效性由 API 层的 resolveIdentity() 处理。
 *
 * 注意：
 * - Access Token 的静默续签由 Gateway（Rust/Pingora）统一完成，覆盖 Portal 与所有第三方子应用
 * - 速率限制由 Gateway 层统一处理，Portal 中间件不做限流
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 白名单路径直接放行
  if (isPublicPath(pathname) || isSkipPath(pathname)) {
    return NextResponse.next();
  }

  // API 路由放行——由 API 层自行鉴权
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // 检查 JWT Cookie 是否存在
  const jwtToken = request.cookies.get(COOKIE_NAMES.JWT);

  if (!jwtToken?.value) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|favicon\\.ico|images|fonts).*)'],
};
