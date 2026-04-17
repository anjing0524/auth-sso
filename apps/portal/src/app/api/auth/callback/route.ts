/**
 * OAuth 回调处理 (加固诊断版)
 */
import { NextRequest, NextResponse } from 'next/server';
import { oauthConfig } from '@/lib/auth-client';
import {
  createSession,
  setSessionCookie,
} from '@/lib/session';
import { decodeJwt } from 'jose';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const requestId = Math.random().toString(36).substring(7);
  const currentUrl = request.url;
  console.log(`[Callback][${requestId}] Start. URL: ${currentUrl}`);

  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!code || !state) {
      console.warn(`[Callback][${requestId}] Missing code or state.`);
      const loginUrl = new URL('/login', request.nextUrl.origin);
      loginUrl.searchParams.set('error', 'invalid_params');
      return NextResponse.redirect(loginUrl.toString());
    }

    const storedState = request.cookies.get('oauth_state')?.value;
    const stateDataStr = request.cookies.get('oauth_state_data')?.value;

    if (!storedState || !stateDataStr || state !== storedState) {
      console.error(`[Callback][${requestId}] State error`);
      const loginUrl = new URL('/login', request.nextUrl.origin);
      loginUrl.searchParams.set('error', 'invalid_state');
      return NextResponse.redirect(loginUrl.toString());
    }

    const stateData = JSON.parse(stateDataStr);
    
    // 发起 Token 交换
    console.log(`[Callback][${requestId}] Fetching token...`);
    const tokenUrl = new URL('/api/auth/oauth2/token', oauthConfig.idpUrl);
    const clientSecret = (process.env.IDP_CLIENT_SECRET || '').trim();
    
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: oauthConfig.redirectUri,
      client_id: oauthConfig.clientId,
      code_verifier: stateData.verifier,
      client_secret: clientSecret,
    });

    let tokenResponse;
    try {
      tokenResponse = await fetch(tokenUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        cache: 'no-store',
      });
    } catch (fetchError: any) {
      console.error(`[Callback][${requestId}] Network Error:`, fetchError.message);
      throw new Error(`Fetch failed: ${fetchError.message}`);
    }

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      console.error(`[Callback][${requestId}] IdP Error ${tokenResponse.status}:`, errorBody);
      throw new Error(`IdP Error ${tokenResponse.status}: ${errorBody}`);
    }

    const tokens = await tokenResponse.json();
    console.log(`[Callback][${requestId}] Token exchange success`);

    // 1. 解码 ID Token 并校验 Nonce
    const decoded = decodeJwt(tokens.id_token);
    console.log(`[Callback][${requestId}] Decoded ID Token:`, JSON.stringify(decoded, null, 2));

    if (stateData.nonce) {
      if (decoded.nonce !== stateData.nonce) {
        console.error(`[Callback][${requestId}] Nonce mismatch! Stored: ${stateData.nonce}, Received: ${decoded.nonce}`);
        const loginUrl = new URL('/login', request.nextUrl.origin);
        loginUrl.searchParams.set('error', 'invalid_nonce');
        return NextResponse.redirect(loginUrl.toString());
      }
      console.log(`[Callback][${requestId}] Nonce verified.`);
    } else {
      console.warn(`[Callback][${requestId}] No nonce found in stateData, skipping verification.`);
    }

    // 2. 创建会话
    const session = await createSession({
      userId: (decoded.sub as string) || (decoded.email as string) || 'unknown',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in || 3600,
    });

    // 确定重定向目标
    const targetPath = stateData.redirect || '/dashboard';
    const redirectUrl = new URL(targetPath, request.url);
    
    console.log(`[Callback][${requestId}] Redirecting to: ${redirectUrl.toString()}`);
    const response = NextResponse.redirect(redirectUrl);
    
    setSessionCookie(response, session.id);
    response.cookies.delete('oauth_state');
    response.cookies.delete('oauth_state_data');

    return response;
  } catch (err: any) {
    console.error(`[Callback][${requestId}] Crash:`, err);
    const stack = err.stack || 'No stack trace';
    const crashUrl = new URL('/login', request.nextUrl.origin);
    crashUrl.searchParams.set('error', 'internal_crash');
    crashUrl.searchParams.set('details', err.message);
    crashUrl.searchParams.set('stack', stack.substring(0, 200));
    return NextResponse.redirect(crashUrl.toString());
  }
}
