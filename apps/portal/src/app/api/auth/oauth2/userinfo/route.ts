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
import { mapDomainError } from '@/domain/shared/error-mapping';
import { getUserProfile } from '@/app/(dashboard)/users/data';


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

    const claims = await verifyAccessToken(token, null); // UserInfo 不校验 audience（多 client 通用端点）
    if (!claims) {
      return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
    }

    // 查询用户档案（委托 data 层，仅取 OIDC 标准字段，不做角色/部门 JOIN）
    const user = await getUserProfile(claims.sub);
    if (!user) {
      return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
    }

    return NextResponse.json({
      sub: user.id,
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
