import { auth, redis } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { decodeJwt } from 'jose';

export const runtime = 'nodejs';

/**
 * SSO 全局登出接口
 * 接收 Bearer Token，识别用户，并销毁该用户的所有 IdP 会话
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const token = authHeader.split(' ')[1];

  try {
    let userId: string | null = null;

    // 1. 尝试使用 Better-Auth 标准 API 获取会话
    const session = await auth.api.getSession({
      headers: request.headers
    });

    if (session) {
      userId = session.user.id;
      console.log(`[SSO-Logout] Identified user via getSession: ${userId}`);
    } else {
      // 2. 如果 getSession 失败，尝试在 oauth_access_tokens 表中查找
      console.log(`[SSO-Logout] getSession failed, searching oauth_access_tokens...`);
      const oauthToken = await db.select()
        .from(schema.oauthAccessTokens)
        .where(eq(schema.oauthAccessTokens.accessToken, token))
        .limit(1);

      if (oauthToken.length > 0) {
        userId = oauthToken[0].userId;
        console.log(`[SSO-Logout] Identified user via oauth_access_tokens: ${userId}`);
      } else {
        // 3. 最后的挣扎：手动解析 JWT
        try {
          const parts = token.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
            userId = payload.sub || null;
            console.log(`[SSO-Logout] Identified user via manual decode: ${userId}`);
          }
        } catch (e) {}
      }
    }

    if (!userId) {
      console.warn(`[SSO-Logout] Could not identify user from token.`);
      return NextResponse.json({ success: true, message: 'No user identified' });
    }

    console.log(`[SSO-Logout] Revoking all sessions for user: ${userId}`);

    // 4. 销毁该用户的所有会话 (包括 Web Cookie 会话)
    // 首先从数据库中获取所有 session token 以便从 Redis 中删除
    const userSessions = await db.select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, userId));

    // 删除数据库记录
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    
    // 清理 Redis 缓存 (关键：Better-Auth 优先从缓存读取)
    if (redis) {
      const pipeline = redis.pipeline();
      // 删除用户会话列表映射
      pipeline.del(`auth-sso:active-sessions-${userId}`);
      // 删除每个具体的会话缓存
      for (const s of userSessions) {
        // 根据 redis-cli KEYS "*" 的结果，键名为 auth-sso:<token>
        pipeline.del(`auth-sso:${s.token}`);
      }
      await pipeline.exec();
      console.log(`[SSO-Logout] Redis cache cleared for user: ${userId}`);
    }
    
    // 5. 同时也要销毁 OAuth Tokens
    await db.delete(schema.oauthAccessTokens).where(eq(schema.oauthAccessTokens.userId, userId));
    await db.delete(schema.oauthRefreshTokens).where(eq(schema.oauthRefreshTokens.userId, userId));

    console.log(`[SSO-Logout] Revocation completed for user: ${userId}`);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[SSO-Logout] Error:', error);
    return NextResponse.json({ error: 'internal_error', message: error.message }, { status: 500 });
  }
}
