/**
 * OAuth 2.1 授权端点 (GET /api/auth/oauth2/authorize)
 *
 * 薄 Controller：仅做编排（校验 → 委托 data 层查询 → 委托 domain 准入检查 → 重定向）。
 * 业务规则判断全部下沉到 domain 纯函数，数据查询委托 data 层，错误映射统一走 mapDomainError()。
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
  buildLoginRedirect,
  clearLoginSessionCookie,
} from '@/lib/oauth-utils';
import { COOKIE_NAMES } from '@auth-sso/contracts';
import { getClientByClientId } from '@/app/(dashboard)/clients/data';
import { getUserWithRoleClients } from './data';
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

export async function GET(request: NextRequest) {
  try {
    // 1. Zod 参数校验
    const url = new URL(request.url);
    const parsed = AuthorizeQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return buildOAuthErrorRedirect(request, 'invalid_request', parsed.error.issues[0]?.message || '参数校验失败');
    }

    const { client_id, redirect_uri, scope, state, nonce, code_challenge, code_challenge_method } = parsed.data;
    const appBaseURL = getAppBaseURL();

    // 2. 校验 Client（委托 data 层查询 + domain 校验）
    const client = await getClientByClientId(client_id);
    validateClientActive(client);
    validateRedirectUri(client!.redirectUris, redirect_uri);

    // 3. 从 Cookie 取 session 并验签（HTTP 专属逻辑）
    const loginSession =
      request.cookies.get(COOKIE_NAMES.LOGIN_SESSION)?.value || request.cookies.get(COOKIE_NAMES.JWT)?.value;

    const sessionClaims = loginSession ? await verifyAccessToken(loginSession) : null;
    if (!sessionClaims) {
      return buildLoginRedirect(appBaseURL, { client_id, redirect_uri, scope, state, nonce, code_challenge, code_challenge_method });
    }

    // 4. 获取用户 + 角色 + Client 绑定（委托 data 层，单次 DB 往返）
    const userWithRoles = await getUserWithRoleClients(sessionClaims.sub);
    if (!userWithRoles) {
      return buildOAuthErrorRedirect(request, 'user_inactive', '用户不存在。');
    }

    // 5. 准入检查（委托 domain 纯函数 — 收敛原先 3 段内联业务规则）
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
        client_id,
      );
    }

    // 6. 生成 Authorization Code 并写入 DB
    const code = `auth_code_${generateId(32)}`;
    const codeId = generateUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);

    await db.insert(schema.authorizationCodes).values({
      id: codeId,
      code,
      clientId: client!.clientId,
      userId: sessionClaims.sub,
      redirectUri: redirect_uri,
      scope,
      state,
      nonce: nonce || null,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
      expiresAt,
      used: false,
      createdAt: now,
    });

    // 7. 302 重定向到 redirect_uri + 清除登录一次性临时凭证
    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set('code', code);
    redirectUrl.searchParams.set('state', state);

    const response = NextResponse.redirect(redirectUrl);
    clearLoginSessionCookie(response);
    return response;
  } catch (err) {
    const mapped = mapDomainError(err);
    return buildOAuthErrorRedirect(request, mapped.error, mapped.message);
  }
}
