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

/**
 * 分支 A：登录后回跳（携带 session_id，从 Redis 恢复授权参数）
 *
 * 流程：验 login_session → Redis GETDEL 恢复参数（原子消费）→ 签发 code → 302 redirect_uri
 *
 * 顺序保证：先验证 login_session 通过，才调用 getStoredAuthRequest（GETDEL 原子读取+删除），
 * 避免 login_session 无效时误删 Redis 参数导致用户重试时 session_expired。
 */
async function handleSessionIdBranch(
  request: NextRequest,
  sessionId: string,
): Promise<NextResponse> {
  const appBaseURL = getAppBaseURL();

  // 1. 先验 login_session Cookie 存在性（未登录回登录页，不消费 Redis key）
  const loginSession = request.cookies.get(COOKIE_NAMES.LOGIN_SESSION)?.value;
  if (!loginSession) {
    return buildLoginPageRedirect(appBaseURL, sessionId);
  }

  // 2. 验证 login_session JWT 有效性（过期/篡改回登录页，不消费 Redis key）
  const sessionClaims = await verifyAccessToken(loginSession);
  if (!sessionClaims) {
    return buildLoginPageRedirect(appBaseURL, sessionId);
  }

  // 3. login_session 验证通过后，原子消费 Redis 暂存参数（GETDEL 读取+删除一步完成）
  const stored = await getStoredAuthRequest(sessionId);
  if (!stored) {
    return buildOAuthErrorRedirect(request, 'session_expired', '授权会话已过期，请重新发起授权');
  }

  return issueCodeAndRedirect(
    request,
    {
      clientId: stored.client_id,
      redirectUri: stored.redirect_uri,
      scope: stored.scope,
      state: stored.state,
      nonce: stored.nonce,
      codeChallenge: stored.code_challenge,
      codeChallengeMethod: stored.code_challenge_method as 'S256',
    },
    sessionClaims.sub,
  );
}

/**
 * 分支 B：首次授权请求（完整 OAuth 2.1 query params）
 *
 * 流程：
 * - 已有有效会话 → 直签授权码（SSO 免登）
 * - 未登录 → 校验 Client → 暂存参数到 Redis → 302 /login?session_id
 */
async function handleFullParamsBranch(
  request: NextRequest,
): Promise<NextResponse> {
  const url = new URL(request.url);
  const appBaseURL = getAppBaseURL();

  const parsed = AuthorizeQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return buildOAuthErrorRedirect(request, 'invalid_request', parsed.error.issues[0]?.message || '参数校验失败');
  }

  const { client_id, redirect_uri, scope, state, nonce, code_challenge, code_challenge_method } = parsed.data;

  // SSO 免登：已有 login_session 或 portal_jwt_token → 直签授权码
  const existingSession =
    request.cookies.get(COOKIE_NAMES.LOGIN_SESSION)?.value || request.cookies.get(COOKIE_NAMES.JWT)?.value;
  const sessionClaims = existingSession ? await verifyAccessToken(existingSession) : null;

  if (sessionClaims) {
    return issueCodeAndRedirect(
      request,
      { clientId: client_id, redirectUri: redirect_uri, scope, state, nonce, codeChallenge: code_challenge, codeChallengeMethod: code_challenge_method },
      sessionClaims.sub,
    );
  }

  // 未登录 → 校验 Client → 暂存参数到 Redis → 302 /login
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
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('session_id');

    if (sessionId) {
      return handleSessionIdBranch(request, sessionId);
    }

    return handleFullParamsBranch(request);
  } catch (err) {
    const mapped = mapDomainError(err);
    return buildOAuthErrorRedirect(request, mapped.error, mapped.message);
  }
}
