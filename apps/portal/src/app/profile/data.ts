import 'server-only';

import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { db, schema } from '@/infrastructure/db';

export interface OwnSecurityActivity {
  activeSessions: Array<{
    id: string;
    scopes: string[];
    createdAt: string;
    expiresAt: string;
  }>;
  recentLogins: Array<{
    id: string;
    eventType: string;
    ip: string | null;
    userAgent: string | null;
    location: string | null;
    failReason: string | null;
    createdAt: string;
  }>;
}

export async function getOwnSecurityActivity(userId: string): Promise<OwnSecurityActivity> {
  const now = new Date();
  const [activeSessions, recentLogins] = await Promise.all([
    db
      .select({
        id: schema.refreshTokens.id,
        scopes: schema.refreshTokens.scopes,
        createdAt: schema.refreshTokens.createdAt,
        expiresAt: schema.refreshTokens.expiresAt,
      })
      .from(schema.refreshTokens)
      .where(and(
        eq(schema.refreshTokens.userId, userId),
        isNull(schema.refreshTokens.revoked),
        gt(schema.refreshTokens.expiresAt, now),
      ))
      .orderBy(desc(schema.refreshTokens.createdAt))
      .limit(10),
    db
      .select({
        id: schema.loginLogs.id,
        eventType: schema.loginLogs.eventType,
        ip: schema.loginLogs.ip,
        userAgent: schema.loginLogs.userAgent,
        location: schema.loginLogs.location,
        failReason: schema.loginLogs.failReason,
        createdAt: schema.loginLogs.createdAt,
      })
      .from(schema.loginLogs)
      .where(eq(schema.loginLogs.userId, userId))
      .orderBy(desc(schema.loginLogs.createdAt))
      .limit(10),
  ]);

  return {
    activeSessions: activeSessions.map((session) => ({
      ...session,
      scopes: session.scopes.split(/\s+/).filter(Boolean),
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
    })),
    recentLogins: recentLogins.map((login) => ({
      ...login,
      createdAt: login.createdAt.toISOString(),
    })),
  };
}
