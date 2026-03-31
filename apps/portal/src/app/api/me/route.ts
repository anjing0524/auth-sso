/**
 * 获取当前用户信息
 * 返回已登录用户的身份和权限上下文
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getSession,
  getSessionIdFromCookie,
  touchSession,
  updateSessionToken,
  shouldRefreshToken,
  deleteSession,
  clearSessionCookie,
} from '@/lib/session';
import { oauthConfig } from '@/lib/auth-client';
import { getUserPermissionContext } from '@/lib/permissions';

export const runtime = 'nodejs';

/**
 * GET /api/me
 * 返回当前用户信息
 */
export async function GET(request: NextRequest) {
  try {
    const sessionId = await getSessionIdFromCookie();

    if (!sessionId) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }

    // 获取 Session
    const session = await getSession(sessionId);

    if (!session) {
      const response = NextResponse.json(
        { error: 'unauthorized', message: '登录已过期' },
        { status: 401 }
      );
      clearSessionCookie(response);
      return response;
    }

    // 检查 Token 是否需要刷新
    if (shouldRefreshToken(session) && session.refreshToken) {
      const refreshed = await refreshToken(sessionId, session.refreshToken);
      if (!refreshed) {
        // 刷新失败，清除 Session
        await deleteSession(sessionId);
        const response = NextResponse.json(
          { error: 'unauthorized', message: '登录已过期' },
          { status: 401 }
        );
        clearSessionCookie(response);
        return response;
      }
    }

    // 更新最后访问时间
    await touchSession(sessionId);

    // 调用 IdP userinfo 端点获取最新用户信息
    const userinfoUrl = new URL('/api/auth/oauth2/userinfo', oauthConfig.idpUrl);
    const response = await fetch(userinfoUrl.toString(), {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Token 无效，清除 Session
        await deleteSession(sessionId);
        const clearResponse = NextResponse.json(
          { error: 'unauthorized', message: '登录已过期' },
          { status: 401 }
        );
        clearSessionCookie(clearResponse);
        return clearResponse;
      }
      return NextResponse.json(
        { error: 'userinfo_failed', message: '获取用户信息失败' },
        { status: response.status }
      );
    }

    const userinfo = await response.json();

    // 获取用户权限上下文
    const permissionContext = await getUserPermissionContext(userinfo.sub);

    return NextResponse.json({
      user: {
        id: userinfo.sub,
        email: userinfo.email,
        name: userinfo.name,
        picture: userinfo.picture,
        emailVerified: userinfo.email_verified,
      },
      session: {
        createdAt: session.createdAt,
        lastAccessAt: session.lastAccessAt,
        expiresAt: session.absoluteExpiresAt,
      },
      // 权限上下文
      permissions: permissionContext?.permissions || [],
      roles: permissionContext?.roles || [],
      dataScopeType: permissionContext?.dataScopeType || 'SELF',
      deptId: permissionContext?.deptId,
    });
  } catch (error) {
    console.error('[Me] Error:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '内部错误' },
      { status: 500 }
    );
  }
}

/**
 * 刷新 Token
 */
async function refreshToken(sessionId: string, refreshToken: string): Promise<boolean> {
  try {
    const tokenUrl = new URL('/api/auth/oauth2/token', oauthConfig.idpUrl);

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: oauthConfig.clientId,
    });

    if (oauthConfig.clientSecret) {
      body.append('client_secret', oauthConfig.clientSecret);
    }

    const response = await fetch(tokenUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      console.error('[Me] Token refresh failed:', response.status);
      return false;
    }

    const tokens = await response.json();

    // 更新 Session 中的 Token
    await updateSessionToken(sessionId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in || 3600,
    });

    return true;
  } catch (error) {
    console.error('[Me] Token refresh error:', error);
    return false;
  }
}