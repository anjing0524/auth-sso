import { auth, redis } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { COMMON_ERRORS } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * POST /api/auth/sign-out-sso
 * 全局单点登出 (Global Single Sign-Out)
 * 接收 Bearer Token，识别操作用户，并在强一致性数据库事务中级联物理销毁其所有的 IdP 登录会话与关联 OAuth 令牌，同时隔离清除 Redis 缓存。
 * 
 * @param request 客户端发起的 NextRequest 请求实例
 * @returns NextResponse 物理注销操作结果的 JSON 响应
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: COMMON_ERRORS.UNAUTHORIZED, message: '未授权访问' },
      { status: 401 }
    );
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
        } catch {
          // 忽略解析错误，继续走后续流程
        }
      }
    }

    if (!userId) {
      console.warn(`[SSO-Logout] Could not identify user from token.`);
      return NextResponse.json({ success: true, message: 'No user identified' });
    }

    console.log(`[SSO-Logout] Revoking all sessions for user: ${userId}`);

    // 4. 销毁该用户的所有会话 (包括 Web Cookie 会话)
    // 首先从数据库中获取所有 session token 以便后续从 Redis 中删除
    const userSessions = await db.select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, userId));

    // 🔥 注入数据库强一致性事务闭环，捍卫级联物理删除的 ACID 原子性，拒绝“半损悬挂状态”
    await db.transaction(async (tx) => {
      // 删除数据库会话记录
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
      // 同时级联物理销毁 OAuth Access & Refresh 令牌
      await tx.delete(schema.oauthAccessTokens).where(eq(schema.oauthAccessTokens.userId, userId));
      await tx.delete(schema.oauthRefreshTokens).where(eq(schema.oauthRefreshTokens.userId, userId));
    });
    
    // 5. 物理事务成功提交后，清理 Redis 缓存 (关键：Better-Auth 优先从缓存读取)
    // 🔥 隔离性故障控制：Redis 清理 pipeline 增设局部防御 try-catch，确保缓存的抖动绝不回滚/阻断核心数据库物理删除的提交
    if (redis) {
      try {
        const pipeline = redis.pipeline();
        // 删除用户会话列表映射
        pipeline.del(`auth-sso:active-sessions-${userId}`);
        // 删除每个具体的会话缓存
        for (const s of userSessions) {
          pipeline.del(`auth-sso:${s.token}`);
        }
        await pipeline.exec();
        console.log(`[SSO-Logout] Redis cache cleared for user: ${userId}`);
      } catch (redisError: unknown) {
        console.error(
          `[SSO-Logout] Redis cache cleanup encountered error for user: ${userId}`,
          redisError instanceof Error ? redisError.stack : redisError
        );
      }
    }

    console.log(`[SSO-Logout] Revocation completed for user: ${userId}`);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[SSO-Logout] Fatal error during Global SSO Logout:', error);
    // 前台返回脱敏的 JSON，后台详尽留痕，确保安全防爆线
    return NextResponse.json(
      { error: COMMON_ERRORS.INTERNAL_ERROR, message: '全局单点登出失败' },
      { status: 500 }
    );
  }
}

