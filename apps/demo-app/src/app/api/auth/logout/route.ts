/**
 * 登出 API
 * POST /api/auth/logout - 登出当前用户
 */
import { NextRequest, NextResponse } from 'next/server';
import { oauthConfig, buildLogoutUrl } from '@/lib/oauth';
import { getSession, clearSession } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * POST /api/auth/logout
 * 登出当前用户
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();

    // 清除本地 Session
    await clearSession();

    // 构建 IdP 登出 URL
    const logoutUrl = buildLogoutUrl(oauthConfig.appUrl);

    return NextResponse.json({
      success: true,
      logoutUrl,
    });
  } catch (error) {
    console.error('[DemoApp] Logout Error:', error);
    return NextResponse.json(
      { error: 'logout_failed', message: '登出失败' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/auth/logout
 * 执行登出并重定向
 */
export async function GET(request: NextRequest) {
  try {
    // 清除本地 Session
    await clearSession();

    // 构建 IdP 登出 URL 并重定向
    const logoutUrl = buildLogoutUrl(oauthConfig.appUrl);

    return NextResponse.redirect(logoutUrl);
  } catch (error) {
    console.error('[DemoApp] Logout Error:', error);
    return NextResponse.redirect(new URL('/?error=logout_failed', oauthConfig.appUrl));
  }
}