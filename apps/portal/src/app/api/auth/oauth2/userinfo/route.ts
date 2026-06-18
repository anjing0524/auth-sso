/**
 * OIDC UserInfo 端点 (GET /api/auth/oauth2/userinfo)
 *
 * 返回当前 Access Token 对应的用户信息。
 * 从 Authorization: Bearer <token> Header 或 portal_jwt_token Cookie 中获取 Token。
 *
 * @route GET /api/auth/oauth2/userinfo
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from '@/lib/auth/token';
import { getJwtFromCookie } from '@/lib/session';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { mapDomainError } from '@/domain/shared/error-mapping';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // 从 Authorization Header 或 Cookie 获取 token
    const authHeader = request.headers.get('authorization');
    const token: string | null = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : await getJwtFromCookie();

    if (!token) {
      return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
    }

    const claims = await verifyAccessToken(token);
    if (!claims) {
      return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
    }

    // 查询用户详情
    const userRows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, claims.sub))
      .limit(1);

    if (userRows.length === 0) {
      return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
    }

    const user = userRows[0]!;

    return NextResponse.json({
      sub: user.publicId,
      name: user.name,
      email: user.email,
      email_verified: user.emailVerified,
      picture: user.avatarUrl,
    });
  } catch (err) {
    const mapped = mapDomainError(err);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}
