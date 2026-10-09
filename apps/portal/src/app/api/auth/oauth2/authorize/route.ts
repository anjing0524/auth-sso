/**
 * OAuth 2.1 授权端点 (GET /api/auth/oauth2/authorize)
 *
 * 薄 Controller：仅做编排（校验 → 委托 data 层查询 → 委托 domain 准入检查 → 重定向）。
 * 业务规则判断全部下沉到 domain 纯函数，数据查询委托 data 层，错误映射统一走 mapServerError()。
 *
 * 两条分支共用同一签发路径：
 * - 分支 A（带 session_id）：登录后回跳，从 Redis 恢复授权参数 + 验 login_session
 * - 分支 B（完整 query params）：首次授权请求；未登录则暂存参数到 Redis 后 302 /login?session_id
 *
 * @route GET /api/auth/oauth2/authorize
 */
import { type NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { verifyAccessToken } from '@/lib/auth/token';
import { parseScopes, validateAuthorization, validateRequestedScopes } from '@/domain/auth/oauth-authorize';
import { validateClientActive, validateRedirectUri } from '@/domain/auth/oauth-client';
import { generateId, generateUUID, hashToken } from '@/lib/crypto';
import { getAppBaseURL, getIssuer } from '@/lib/env';
import { mapServerError } from '@/lib/server-error';
import { mapToOAuthError } from '@/domain/shared/error-mapping';
import {
  buildOAuthErrorRedirect,
  buildRfc6749ErrorRedirect,
  buildLoginPageRedirect,
  clearLoginSessionCookie,
} from '@/lib/oauth-utils';
import { COOKIE_NAMES, JWT_TYP, PORTAL_AUD, PORTAL_CLIENT_ID } from '@auth-sso/contracts';
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
  validateClientActive(client ?? undefined);
  validateRedirectUri(client!.redirectUris, params.redirectUri);
  // redirect_uri 已通过白名单校验：此后的授权拒绝按 RFC 6749 §4.1.2.1 重定向回 RP
  //（error/state/iss）；此前的失败（client 未知/停用、参数畸形）仍走本地错误页——
  // 不得向未验证的 redirect_uri 重定向（决策 D1）
  try {
    validateRequestedScopes(parseScopes(params.scope), parseScopes(client!.scopes));
  } catch (err) {
    const mapped = mapServerError(err);
    return buildRfc6749ErrorRedirect(params.redirectUri, {
      error: mapToOAuthError(mapped.error),
      errorDescription: mapped.message,
      state: params.state,
      iss: getIssuer(),
    });
  }

  const userWithRoles = await getUserWithRoleClients(userId);
  if (!userWithRoles) {
    return buildRfc6749ErrorRedirect(params.redirectUri, {
      error: 'user_inactive',
      state: params.state,
      iss: getIssuer(),
    });
  }

  const accessCheck = validateAuthorization({
    userId: userWithRoles.id,
    clientId: client!.clientId,
    status: userWithRoles.status,
    roles: userWithRoles.roles,
  });
  if (!accessCheck.allowed) {
    return buildRfc6749ErrorRedirect(params.redirectUri, {
      error: accessCheck.errorCode || 'unauthorized_client',
      errorDescription: accessCheck.message || undefined,
      state: params.state,
      iss: getIssuer(),
    });
  }

  // 明文 code 只经重定向交给 RP；**库中存其哈希**（与 Refresh Token 同一策略）。
  // 授权码是可以换取令牌的凭证，DB 泄露 / 备份被读取时不应可直接使用。
  const code = `auth_code_${generateId(32)}`;
  const codeId = generateUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);

  await db.insert(schema.authorizationCodes).values({
    id: codeId,
    code: hashToken(code),
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
  // RFC 9207：授权响应携带 iss（mix-up 攻击防御，RFC 9700 §4.4.2.1 首选对策）
  redirectUrl.searchParams.set('iss', getIssuer());

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
  const sessionClaims = await verifyAccessToken(loginSession, PORTAL_AUD, JWT_TYP.LOGIN_SESSION);
  if (!sessionClaims) {
    return buildLoginPageRedirect(appBaseURL, sessionId);
  }

  // 3. login_session 验证通过后，原子消费 Redis 暂存参数（GETDEL 读取+删除一步完成）
  const stored = await getStoredAuthRequest(sessionId);
  if (!stored) {
    return buildOAuthErrorRedirect(request, 'session_expired', '授权会话已过期，请重新发起授权');
  }

  return issueCodeAndRedirect(
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
  // typ 按 Cookie 来源区分校验（RFC 8725 §3.11）：login_session → login+jwt，AT → at+jwt
  const loginSessionValue = request.cookies.get(COOKIE_NAMES.LOGIN_SESSION)?.value;
  const jwtSessionValue = loginSessionValue ? undefined : request.cookies.get(COOKIE_NAMES.JWT)?.value;
  const existingSession = loginSessionValue || jwtSessionValue;
  const expectedTyp = loginSessionValue ? JWT_TYP.LOGIN_SESSION : JWT_TYP.ACCESS_TOKEN;
  // aud 按凭证类型区分（ADR-013）：LoginSession = 体系级 auth-sso，AT = 签发对象 client_id
  const expectedAud = loginSessionValue ? PORTAL_AUD : PORTAL_CLIENT_ID;
  const sessionClaims = existingSession
    ? await verifyAccessToken(existingSession, expectedAud, expectedTyp)
    : null;

  if (sessionClaims) {
    return issueCodeAndRedirect(
      { clientId: client_id, redirectUri: redirect_uri, scope, state, nonce, codeChallenge: code_challenge, codeChallengeMethod: code_challenge_method },
      sessionClaims.sub,
    );
  }

  // 未登录 → 校验 Client → 暂存参数到 Redis → 302 /login
  const client = await getClientByClientId(client_id);
  validateClientActive(client ?? undefined);
  validateRedirectUri(client!.redirectUris, redirect_uri);
  // redirect_uri 已过白名单：scope 越界同样按 RFC 6749 §4.1.2.1 重定向回 RP（决策 D1）
  try {
    validateRequestedScopes(parseScopes(scope), parseScopes(client!.scopes));
  } catch (err) {
    const mapped = mapServerError(err);
    return buildRfc6749ErrorRedirect(redirect_uri, {
      error: mapToOAuthError(mapped.error),
      errorDescription: mapped.message,
      state,
      iss: getIssuer(),
    });
  }

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
      // 必须 await：`return promise` 不会触发本层 catch（异步拒绝穿透 try 语义）
      return await handleSessionIdBranch(request, sessionId);
    }

    return await handleFullParamsBranch(request);
  } catch (err) {
    const mapped = mapServerError(err);
    return buildOAuthErrorRedirect(request, mapped.error, mapped.message);
  }
}
