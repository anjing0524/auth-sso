/**
 * Token 静默刷新端点
 *
 * 前端 SPA 在 Access Token 临近过期时调用此接口，Portal BFF 使用
 * portal_refresh_token Cookie 向 IdP 换取新的 Access Token，
 * 并将新 Token 写回 Cookie，前端无需处理任何 Token，全程透明。
 */
import { NextRequest, NextResponse } from 'next/server';
import { oauthConfig } from '@/lib/auth-client';
import { getRefreshTokenFromCookie, setJwtCookies, clearJwtCookies } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * POST /api/auth/refresh
 * 使用 Refresh Token Cookie 静默换取新的 Access Token
 *
 * @param request NextRequest 对象
 * @returns 成功：200 {success: true, expiresAt: number}；失败：401（需重新登录）
 */
export async function POST(request: NextRequest) {
  try {
    // 1. 读取 Refresh Token Cookie
    const refreshToken = await getRefreshTokenFromCookie();
    if (!refreshToken) {
      return NextResponse.json(
        { error: 'no_refresh_token', message: '未登录或 Refresh Token 已过期，请重新登录' },
        { status: 401 }
      );
    }

    // 2. 向 IdP 换取新的 Token 对
    const tokenUrl = new URL('/api/auth/oauth2/token', oauthConfig.idpUrl);
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: oauthConfig.clientId,
    });

    if (oauthConfig.clientSecret) {
      body.append('client_secret', oauthConfig.clientSecret);
    }

    const tokenResponse = await fetch(tokenUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      cache: 'no-store',
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      console.warn('[Refresh] IdP Token 刷新失败:', tokenResponse.status, errorBody);

      // Refresh Token 已失效（过期 / 被撤销），要求重新登录
      const response = NextResponse.json(
        { error: 'refresh_failed', message: '登录已过期，请重新登录' },
        { status: 401 }
      );
      clearJwtCookies(response);
      return response;
    }

    const tokens = await tokenResponse.json();

    // 3. 将新 Token 写回 HttpOnly Cookie
    const expiresIn: number = tokens.expires_in || 3600;
    const response = NextResponse.json({
      success: true,
      /** Access Token 过期时间戳（ms），前端用于调度下一次静默刷新 */
      expiresAt: Date.now() + expiresIn * 1000,
    });

    setJwtCookies(response, tokens.access_token, tokens.refresh_token, expiresIn);

    return response;
  } catch (error) {
    console.error('[Refresh] Token 刷新流程异常:', error);
    return NextResponse.json(
      { error: 'refresh_error', message: '刷新失败，请重新登录' },
      { status: 500 }
    );
  }
}
