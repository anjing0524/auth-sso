/**
 * OAuth 2.1 授权端点 (GET /api/auth/oauth2/authorize)
 *
 * 薄 Controller：仅做编排（校验 → 委托 data 层查询 → 委托 domain 准入检查 → 重定向）。
 * 业务规则判断全部下沉到 domain 纯函数，数据查询委托 data 层，错误映射统一走 mapDomainError()。
 *
 * 两条分支共用同一签发路径：
 * - 分支 A（带 session_id）：登录后回跳，从 Redis 恢复授权参数 + 验 login_session
 * - 分支 B（完整 query params）：首次授权请求；未登录则暂存参数到 Redis 后 302 /login?session_id
 *
 * @route GET /api/auth/oauth2/authorize
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { verifyAccessToken } from '@/lib/auth/token';
import { validateAuthorization } from '@/domain/auth/oauth-authorize';
import { validateClientActive, validateRedirectUri } from '@/domain/auth/oauth-client';
import { generateId, generateUUID } from '@/lib/crypto';
import { getAppBaseURL } from '@/lib/env';
import { mapDomainError } from '@/domain/shared/error-mapping';
import {
  buildOAuthErrorRedirect,
  buildLoginPageRedirect,
  clearLoginSessionCookie,
} from '@/lib/oauth-utils';
import { COOKIE_NAMES } from '@auth-sso/contracts';
import { getClientByClientId } from '@/app/(dashboard)/clients/data';
import { getUserWithRoleClients } from './data';
import {
  storeAuthRequest,
  getStoredAuthRequest,
  deleteStoredAuthRequest,
  generateSessionId,
} from '@/lib/session/auth-request-store';
import type { StoredAuthRequest } from '@/domain/auth/types';
import { z } from 'zod';

const AuthorizeQuerySchema = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  response_type: z.literal('code'),
  scope: z.string(),
  state: z.string(),
  nonce: z.string().optional(),
  code_challenge: z.string().min(1),
  code_challenge_method: z.literal('S256'),
});

/**
 * 签发授权码并 302 重定向到 redirect_uri（两条分支共用）。
 *
 * 步骤：获取用户角色 → 准入检查 → 写入 authorization_codes 表 → 302 带 code + state。
 * 成功时清除 login_session 一次性凭证。
 */
async function issueCodeAndRedirect(
  request: NextRequest,
  params: {
    clientId: string;
    redirectUri: string;
    scope: string;
    state: string;
    nonce?: string | null;
    codeChallenge: string;
    /** PKCE 方法，全局固定为 S256（与 authorization_codes.code_challenge_method 列类型一致） */
    codeChallengeMethod: 'S256';
  },
  userId: string,
): Promise<NextResponse> {
  const client = await getClientByClientId(params.clientId);
  validateClientActive(client);
  validateRedirectUri(client!.redirectUris, params.redirectUri);

  const userWithRoles = await getUserWithRoleClients(userId);
  if (!userWithRoles) {
    return buildOAuthErrorRedirect(request, 'user_inactive', '用户不存在。');
  }

  const accessCheck = validateAuthorization({
    userId: userWithRoles.id,
    clientId: client!.clientId,
    status: userWithRoles.status,
    roles: userWithRoles.roles,
  });
  if (!accessCheck.allowed) {
    return buildOAuthErrorRedirect(
      request,
      accessCheck.errorCode || 'unauthorized_client',
      accessCheck.message || '',
      params.clientId,
    );
  }

  const code = `auth_code_${generateId(32)}`;
  const codeId = generateUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);

  await db.insert(schema.authorizationCodes).values({
    id: codeId,
    code,
    clientId: client!.clientId,
    userId,
    redirectUri: params.redirectUri,
    scope: params.scope,
    state: params.state,
    nonce: params.nonce || null,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: params.codeChallengeMethod,
    expiresAt,
    used: false,
    createdAt: now,
  });

  const redirectUrl = new URL(params.redirectUri);
  redirectUrl.searchParams.set('code', code);
  redirectUrl.searchParams.set('state', params.state);

  const response = NextResponse.redirect(redirectUrl);
  clearLoginSessionCookie(response);
  return response;
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const appBaseURL = getAppBaseURL();
    const sessionId = url.searchParams.get('session_id');

    // ── 分支 A：登录后回跳（携带 session_id，从 Redis 恢复授权参数）──
    if (sessionId) {
      const stored = await getStoredAuthRequest(sessionId);
      if (!stored) {
        return buildOAuthErrorRedirect(request, 'session_expired', '授权会话已过期，请重新发起授权');
      }
      // 验证 login_session Cookie（登录端点刚写入，5min 窗口内）
      const loginSession = request.cookies.get(COOKIE_NAMES.LOGIN_SESSION)?.value;
      if (!loginSession) {
        return buildLoginPageRedirect(appBaseURL, sessionId);
      }
      const sessionClaims = await verifyAccessToken(loginSession);
      if (!sessionClaims) {
        return buildLoginPageRedirect(appBaseURL, sessionId);
      }

      // 一次性消费：login_session 验证通过后再删 Redis key，防止过早删除导致
      // login_session 缺失时回退到 /login 却找不到参数的竞态窗口
      deleteStoredAuthRequest(sessionId);

      return issueCodeAndRedirect(
        request,
        {
          clientId: stored.client_id,
          redirectUri: stored.redirect_uri,
          scope: stored.scope,
          state: stored.state,
          nonce: stored.nonce,
          codeChallenge: stored.code_challenge,
          // Redis 存入前已由 zod z.literal('S256') 校验，运行时必为 S256
          codeChallengeMethod: stored.code_challenge_method as 'S256',
        },
        sessionClaims.sub,
      );
    }

    // ── 分支 B：首次授权请求（完整 OAuth query params）──
    const parsed = AuthorizeQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return buildOAuthErrorRedirect(request, 'invalid_request', parsed.error.issues[0]?.message || '参数校验失败');
    }

    const { client_id, redirect_uri, scope, state, nonce, code_challenge, code_challenge_method } = parsed.data;

    // 尝试已有会话（login_session > portal_jwt_token）— SSO 免登场景
    const existingSession =
      request.cookies.get(COOKIE_NAMES.LOGIN_SESSION)?.value || request.cookies.get(COOKIE_NAMES.JWT)?.value;
    const sessionClaims = existingSession ? await verifyAccessToken(existingSession) : null;

    if (sessionClaims) {
      // 已登录 → 直接签发授权码
      return issueCodeAndRedirect(
        request,
        {
          clientId: client_id,
          redirectUri: redirect_uri,
          scope,
          state,
          nonce,
          codeChallenge: code_challenge,
          codeChallengeMethod: code_challenge_method,
        },
        sessionClaims.sub,
      );
    }

    // 未登录 → 校验 Client 后暂存参数到 Redis → 302 /login?session_id
    const client = await getClientByClientId(client_id);
    validateClientActive(client);
    validateRedirectUri(client!.redirectUris, redirect_uri);

    const newSessionId = generateSessionId();
    const stored: StoredAuthRequest = {
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method,
      scope,
      state,
      nonce: nonce || null,
    };
    await storeAuthRequest(newSessionId, stored);
    return buildLoginPageRedirect(appBaseURL, newSessionId);
  } catch (err) {
    const mapped = mapDomainError(err);
    return buildOAuthErrorRedirect(request, mapped.error, mapped.message);
  }
}
