/**
 * Session 状态检查
 * 用于前端判断是否已登录
 */
import { NextResponse } from 'next/server';
import { getSessionIdFromCookie, getSession } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * GET /api/auth/session
 * 返回当前 Session 状态
 */
export async function GET() {
  try {
    const sessionId = await getSessionIdFromCookie();

    if (!sessionId) {
      return NextResponse.json({ authenticated: false });
    }

    const session = await getSession(sessionId);

    if (!session) {
      return NextResponse.json({ authenticated: false });
    }

    return NextResponse.json({
      authenticated: true,
      user: session.userInfo,
      tokenExpiresAt: session.tokenExpiresAt,
    });
  } catch (error) {
    console.error('[Session-CG] Error:', error);
    return NextResponse.json({ authenticated: false });
  }
}