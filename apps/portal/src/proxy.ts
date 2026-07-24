import { type NextRequest, NextResponse } from 'next/server';
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
 * Next.js Proxy 路由守卫。
 *
 * PKCE 生成 + OAuth 2.1 授权链路由 Gateway（Rust/Pingora）统一完成。
 * proxy.ts 仅检查 JWT Cookie 存在性——有 JWT 放行，无 JWT 透传。
 *
 * @impl H-AUTH-001 — 未登录拦截与重定向
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname) || isSkipPath(pathname) || pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const jwtToken = request.cookies.get(COOKIE_NAMES.JWT);

  if (!jwtToken?.value) {
    // Gateway 已在边缘层拦截无 JWT 的 HTML 页面导航，生成 PKCE 并 302 /authorize。
    // 若请求到达此处，说明 Gateway 未配置或已穿透——透传给下游自行处理。
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|favicon\\.ico|images|fonts).*)'],
};
