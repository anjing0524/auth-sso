'use server';

/**
 * 个人中心 — 自助撤销登录会话。
 *
 * 只有登录用户本人可调用（withAuth 空权限），目标从 ctx.userId 反查，
 * 不能撤销别人的会话（防 IDOR）。这里撤销的是 refresh token：该设备无法
 * 再续期；已签发的 access token 仍会在自然过期前有效（≤1h），文案必须诚实说明。
 */
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';

import { db, schema } from '@/infrastructure/db';
import { withAuth, type AuthContext } from '@/lib/auth';
import { revokeRefreshTokenById } from '@/lib/auth/token/revocation';
import { validate } from '@/lib/validation';
import type { ApiResponse } from '@auth-sso/contracts';

const RevokeSessionSchema = z.object({ sessionId: z.string().uuid() });

export const revokeOwnSessionAction = withAuth(
  {},
  async (ctx: AuthContext, sessionId: string): Promise<ApiResponse<{ revoked: boolean }>> => {
    const v = validate(RevokeSessionSchema, { sessionId });
    if (!v.ok) return v.response;

    // 归属校验：只能撤销 userId === 当前登录者的 refresh token
    const row = await db.query.refreshTokens.findFirst({
      where: and(eq(schema.refreshTokens.id, v.data.sessionId), eq(schema.refreshTokens.userId, ctx.userId)),
      columns: { id: true, revoked: true },
    });
    // 不存在/不属于自己：不区分语义，避免探测他人会话是否存在
    if (!row) return { success: true, data: { revoked: false }, message: '该会话已失效' };
    if (row.revoked) return { success: true, data: { revoked: false }, message: '该会话已失效' };

    await revokeRefreshTokenById(db, v.data.sessionId);
    return {
      success: true,
      data: { revoked: true },
      message: '已撤销该会话：此设备将无法续期（已签发的访问令牌最长 1 小时后失效）',
    };
  },
);
