/**
 * JWKS 公钥端点 (GET /api/auth/jwks)
 *
 * 返回 ES256 公钥集，供 Gateway 离线验签使用。
 * 符合 RFC 7517 格式。
 *
 * @route GET /api/auth/jwks
 */
import { NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { or, gt, isNull } from 'drizzle-orm';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { getActiveSigningKey } from '@/lib/auth/token';

export async function GET() {
  try {
    // 自动确保数据库中至少有一个活跃的密钥对，防止冷启动时 Gateway 连接 JWKS 死锁
    await getActiveSigningKey();

    // 仅返回未过期的密钥（expiresAt > now 或 expiresAt 为 NULL 的兜底），避免暴露历史密钥
    const rows = await db
      .select()
      .from(schema.jwks)
      .where(or(
        gt(schema.jwks.expiresAt, new Date()),
        isNull(schema.jwks.expiresAt),
      ))
      .orderBy(schema.jwks.createdAt);

    const keys = rows.map((row) => {
      const jwk = JSON.parse(row.publicKey) as JsonWebKey;
      return {
        ...jwk,
        kid: row.kid ?? row.id, // 使用 kid 列（与 JWT header.kid 一致），兼容旧数据无 kid 时回退 id
        use: 'sig',
        alg: 'ES256',
      };
    });

    return NextResponse.json({ keys });
  } catch (err) {
    const mapped = mapDomainError(err);
    return NextResponse.json({ error: mapped.error, message: mapped.message }, { status: mapped.status });
  }
}
