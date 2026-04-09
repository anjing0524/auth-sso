/**
 * OAuth 登出
 * 清除 Session Cookie 和 Redis Session
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionIdFromCookie, deleteSession, clearSessionCookie } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * GET /api/auth/logout
 * 登出并重定向到首页
 */
export async function GET(request: NextRequest) {
  try {
    // 获取 Session ID
    const sessionId = await getSessionIdFromCookie();

    // 删除 Redis Session
    if (sessionId) {
      await deleteSession(sessionId);
    }

    // 创建响应并清除 Cookie
    const response = NextResponse.redirect(new URL('/', request.url));
    clearSessionCookie(response);

    return response;
  } catch (error) {
    console.error('[Logout-CG] Error:', error);
    return NextResponse.redirect(new URL('/', request.url));
  }
}