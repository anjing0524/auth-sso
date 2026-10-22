import { type NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAMES } from '@auth-sso/contracts';
import { getTrustedOrigins } from '@/lib/env';

/**
 * 不需要认证即可访问的路径前缀（白名单）
 *
 * /oauth/error：OAuth 错误页。未登录用户（如登录回跳时 login_session 已过期）
 * 也会被引导到此页，必须放行，否则错误上下文会被 302 /login 吞掉。
 * （历史上白名单里的 '/oauth2' 是死配置：实际端点在 /api/auth/oauth2，
 * 已被下方 /api/ 跳过覆盖。）
 */
const PUBLIC_PATHS = [
  '/login',
  '/oauth/error',
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
 * 同源校验（CSRF 纵深防线）— ADR-005 第 2 层承诺的 Origin 校验。
 *
 * Browser-Based Apps BCP 要求：cookie 认证的 BFF 在 SameSite 之外必须叠加
 * Origin 校验（可验证的 SameSite 支持并不普适）。浏览器对全部写请求都会附
 * Origin 头；服务端间调用（Gateway→Portal 续签/换 token）无 Origin 头，天然放行。
 * GET/HEAD 无状态变更，不校验。
 *
 * 信任来源与 Next.js Server Actions 内建校验同语义：
 * 1. getTrustedOrigins()（NEXT_PUBLIC_APP_URL / TRUSTED_ORIGINS / dev 默认端口）
 * 2. X-Forwarded-Host — Gateway 权威覆写的公网 Host（upstream_request_filter
 *    先删后写，不透传客户端值）。与既有信任前提一致：Portal 仅接收经 Gateway
 *    转发的流量；Portal 被直连时该前提整体失效，非本层职责。
 * 3. 请求自身 Host — 无 Gateway 的直连形态（本地 dev 直连 4100）。
 */
function isCrossSiteWrite(request: NextRequest): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    return false;
  }
  const origin = request.headers.get('origin');
  if (!origin) return false;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true;
  }
  if (getTrustedOrigins().includes(origin)) return false;

  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (forwardedHost && originHost === forwardedHost) return false;

  return originHost !== request.headers.get('host');
}

/**
 * Next.js Proxy 路由守卫。
 *
 * PKCE 生成 + OAuth 2.1 授权链路由 Gateway（Rust/Pingora）统一完成。
 * proxy.ts 仅检查 JWT Cookie 存在性——有 JWT 放行，无 JWT 透传；
 * 写请求额外做同源校验（CSRF 纵深）。
 *
 * @impl H-AUTH-001 — 未登录拦截与重定向
 */
export async function proxy(request: NextRequest) {
  if (isCrossSiteWrite(request)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

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
