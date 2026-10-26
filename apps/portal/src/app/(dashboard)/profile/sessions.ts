import 'server-only';

/**
 * 个人中心的"会话记录"真实数据（替代此前的占位卡片）。
 *
 * 此前「会话记录」Tab 只有一句"设备身份校验已启用 / 全局 SSO 节点"的静态占位，
 * 用户无法知道自己在哪些设备上登录、当前会话何时过期——这是 UI 与功能不对齐。
 *
 * 数据来源严格是**真实存在的**：`refresh_tokens` 表里该用户未撤销且未过期的记录
 * + 当前 JWT Cookie 的 claims（由 profile/page.tsx 读取）。
 */
import { and, desc, eq, gt, isNull } from 'drizzle-orm';

import { db, schema } from '@/infrastructure/db';

export interface OwnSession {
  id: string;
  clientId: string;
  scopes: string;
  createdAt: string;
  expiresAt: string;
  authTime: string | null;
  /** 该行是否就是当前浏览器设备（AT sid == refresh session id） */
  isCurrent: boolean;
}

/** 当前用户仍然活跃的会话（按建立时间倒序，最多 10 条） */
export async function getOwnSessions(userId: string, currentSessionId?: string): Promise<OwnSession[]> {
  const now = new Date();
  const rows = await db
    .select({
      id: schema.refreshTokens.id,
      clientId: schema.refreshTokens.clientId,
      scopes: schema.refreshTokens.scopes,
      createdAt: schema.refreshTokens.createdAt,
      expiresAt: schema.refreshTokens.expiresAt,
      authTime: schema.refreshTokens.authTime,
    })
    .from(schema.refreshTokens)
    .where(
      and(
        eq(schema.refreshTokens.userId, userId),
        isNull(schema.refreshTokens.revoked),
        gt(schema.refreshTokens.expiresAt, now),
      ),
    )
    .orderBy(desc(schema.refreshTokens.createdAt))
    .limit(10);

  return rows.map((row) => ({
    id: row.id,
    clientId: row.clientId,
    scopes: row.scopes,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    authTime: row.authTime ? row.authTime.toISOString() : null,
    isCurrent: Boolean(currentSessionId) && row.id === currentSessionId,
  }));
}
