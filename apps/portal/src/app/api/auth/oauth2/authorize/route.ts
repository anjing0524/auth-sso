/**
 * OAuth 2.1 授权端点 (GET /api/auth/oauth2/authorize)
 *
 * Controller 职责：编排（Zod 校验 → Drizzle 查询 → 领域函数校验 → 写 DB → 重定向）
 * 业务规则判断全部下沉到 domain 纯函数，错误映射统一走 mapDomainError()。
 *
 * @route GET /api/auth/oauth2/authorize
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq, inArray } from 'drizzle-orm';
import { verifyAccessToken } from '@/domain/auth/token';
import { checkUserClientAccess } from '@/domain/auth/oauth-authorize';
import { validateClientActive, validateRedirectUri } from '@/domain/auth/oauth-client';
import { generateId } from '@/lib/crypto';
import { getAppBaseURL } from '@/lib/env';
import { mapDomainError } from '@/domain/shared/error-mapping';
import {
  buildOAuthErrorRedirect,
  buildLoginRedirect,
  clearLoginSessionCookie,
} from '@/lib/oauth-utils';
import { ENTITY_ACTIVE } from '@auth-sso/contracts';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    // 1. Zod 参数校验（失败则重定向到 error 页）
    const url = new URL(request.url);
    const parsed = AuthorizeQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return buildOAuthErrorRedirect(request, 'invalid_request', parsed.error.issues[0]?.message || '参数校验失败');
    }

    const { client_id, redirect_uri, scope, state, nonce, code_challenge, code_challenge_method } = parsed.data;
    const appBaseURL = getAppBaseURL();

    // 2. 校验 Client
    const clientRows = await db.select().from(schema.clients).where(eq(schema.clients.clientId, client_id)).limit(1);
    validateClientActive(clientRows[0]);
    const client = clientRows[0]!;
    validateRedirectUri(client.redirectUrls, redirect_uri);

    // 3. 从 Cookie 取 login_session（新鲜登录）或 portal_jwt_token（已登录）
    const loginSession =
      request.cookies.get('login_session')?.value || request.cookies.get('portal_jwt_token')?.value;

    // 4. 验签 session JWT
    const sessionClaims = loginSession ? await verifyAccessToken(loginSession) : null;
    if (!sessionClaims) {
      return buildLoginRedirect(appBaseURL, { client_id, redirect_uri, scope, state, nonce, code_challenge, code_challenge_method });
    }

    const userId = sessionClaims.sub;

    // 5. 校验用户状态
    const userRows = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (!userRows[0] || userRows[0].status !== ENTITY_ACTIVE) {
      return buildOAuthErrorRedirect(request, 'user_inactive', '您的账号已被锁定或禁用，请联系管理员。');
    }

    // 6. 角色 + Client 访问权限检查
    const userRoles = await db
      .select({ id: schema.roles.id, code: schema.roles.code, status: schema.roles.status })
      .from(schema.roles)
      .innerJoin(schema.userRoles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(eq(schema.userRoles.userId, userId));

    if (userRoles.length === 0) {
      return buildOAuthErrorRedirect(request, 'no_roles', '您的账号尚未分配任何角色，无法访问系统。');
    }

    const roleClients = await db
      .select()
      .from(schema.roleClients)
      .where(inArray(schema.roleClients.roleId, userRoles.map((r) => r.id)));

    const accessCheck = checkUserClientAccess({ userId, clientId: client_id, roles: userRoles, roleClients });
    if (!accessCheck.allowed) {
      return buildOAuthErrorRedirect(request, accessCheck.errorCode || 'unauthorized_client', accessCheck.message || '', client_id);
    }

    // 7. 生成 Authorization Code 并写入 DB
    const code = `auth_code_${generateId(32)}`;
    const codeId = generateId(20);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);

    await db.insert(schema.authorizationCodes).values({
      id: codeId,
      code,
      clientId: client.id,
      userId,
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

    // 8. 302 重定向到 redirect_uri + 清除 login_session 一次性临时凭证
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
