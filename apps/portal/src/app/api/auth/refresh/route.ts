/**
 * Token 刷新 API (POST /api/auth/refresh)
 *
 * Refresh Token Rotation：消耗旧 RT，签发新 AT + RT。
 *
 * 优化：如果当前 Access Token 剩余时间 > 5 分钟，跳过刷新（避免无效的 token 轮换）。
 *
 * @route POST /api/auth/refresh
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getRefreshTokenFromCookie, getJwtFromCookie, decodeJwtPayload } from '@/lib/session';
import { rotateRefreshToken } from '@/lib/auth/token';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { AUTH_ERRORS, COOKIE_NAMES, TOKEN_TTL } from '@auth-sso/contracts';
import { writeLoginLog, extractClientIP, extractUserAgent } from '@/lib/audit';
import { isCookieSecure, getGatewaySharedSecret } from '@/lib/env';
import { verifySignature, SIGNATURE_TIMESTAMP_WINDOW_SEC } from '@/lib/auth/gateway-hmac';

/** 刷新阈值（秒）：仅当 Access Token 剩余时间 < 此值时执行刷新 */
const REFRESH_THRESHOLD = 5 * 60; // 5 minutes

/**
 * 校验请求是否来自受信任的 Gateway（决定 token 是否可在 JSON body 回传）。
 *
 * Gateway 的续签调用携带 `X-Gateway-Timestamp` + `X-Gateway-Signature`
 * （payload 为域分离的 `refresh:{ts}`，见 gateway/src/auth/refresh.rs）。
 * 浏览器同源脚本没有共享密钥，无法通过此端点从 body 读取 HttpOnly 保护的 token。
 */
async function isRefreshCallFromGateway(request: NextRequest): Promise<boolean> {
  const ts = request.headers.get('x-gateway-timestamp') ?? undefined;
  const sig = request.headers.get('x-gateway-signature') ?? undefined;
  if (!ts || !sig) return false;
  return verifySignature(
    getGatewaySharedSecret(),
    `refresh:${ts}`,
    ts,
    sig,
    SIGNATURE_TIMESTAMP_WINDOW_SEC,
  );
}

export async function POST(request: NextRequest) {
  try {
    const refreshToken = await getRefreshTokenFromCookie();
    if (!refreshToken) {
      return NextResponse.json(
        { error: AUTH_ERRORS.REFRESH_TOKEN_MISSING, message: '缺少 Refresh Token' },
        { status: 401 },
      );
    }

    // 检查当前 Access Token 的剩余时间，避免不必要的 token 轮换（H-SESS-003）
    const accessToken = await getJwtFromCookie();
    if (accessToken) {
      const claims = decodeJwtPayload(accessToken);
      if (claims?.exp) {
        const remaining = claims.exp - Math.floor(Date.now() / 1000);
        if (remaining > REFRESH_THRESHOLD) {
          return NextResponse.json({ skipped: true, remaining });
        }
      }
    }

    // 从当前 AT 中获取用户信息（用于日志）
    const currentAT = await getJwtFromCookie();
    const atPayload = currentAT ? decodeJwtPayload(currentAT) : null;
    const username = atPayload?.sub || 'unknown';
    const ip = extractClientIP(request.headers);
    const ua = extractUserAgent(request.headers);

    const result = await rotateRefreshToken(refreshToken);
    if (!result) {
      writeLoginLog({ userId: atPayload?.sub, username, eventType: 'TOKEN_REFRESH_FAILED', ip, userAgent: ua, failReason: 'Refresh Token 无效或已过期' });
      const response = NextResponse.json(
        { error: AUTH_ERRORS.REFRESH_TOKEN_INVALID, message: 'Refresh Token 无效或已过期' },
        { status: 401 },
      );
      // 清除无效 Cookie
      response.cookies.set(COOKIE_NAMES.JWT, '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 });
      response.cookies.set(COOKIE_NAMES.REFRESH, '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 });
      return response;
    }

    // 续签成功 → 记录 TOKEN_REFRESH 日志
    writeLoginLog({ userId: atPayload?.sub, username, eventType: 'TOKEN_REFRESH', ip, userAgent: ua });

    const secure = isCookieSecure();
    // JSON body 仅对受信任的 Gateway 调用回传 token 明文（调用方已通过
    // isRefreshCallFromGateway 证明自己持有共享密钥）；浏览器同源脚本
    // 无法伪造此头，在此端点只能看到 { expiresIn } + Set-Cookie。
    const trustedGateway = await isRefreshCallFromGateway(request);
    const body: Record<string, unknown> = { expiresIn: result.expiresIn };
    if (trustedGateway) {
      body.accessToken = result.accessToken;
      body.refreshToken = result.refreshToken;
    }
    const response = NextResponse.json(body);

    response.cookies.set(COOKIE_NAMES.JWT, result.accessToken, {
      path: '/',
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: result.expiresIn,
    });

    response.cookies.set(COOKIE_NAMES.REFRESH, result.refreshToken, {
      path: '/',
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: TOKEN_TTL.REFRESH_TOKEN,
    });

    return response;
  } catch (err) {
    const mapped = mapDomainError(err);
    return NextResponse.json(
      { error: mapped.error, message: mapped.message },
      { status: mapped.status },
    );
  }
}
