/**
 * JWKS 公钥端点 (GET /api/auth/jwks)
 *
 * 返回 ES256 公钥集，供 Gateway 离线验签使用。
 * 符合 RFC 7517 格式。
 *
 * @route GET /api/auth/jwks
 */
import { connection, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { or, gt, isNull } from 'drizzle-orm';
import { mapServerError } from '@/lib/server-error';
import { getActiveSigningKey } from '@/lib/auth/token';
import { JWKS_PUBLISH_GRACE_SECS } from '@auth-sso/contracts';

export async function GET() {
  await connection();
  try {
    // 自动确保数据库中至少有一个活跃的密钥对，防止冷启动时 Gateway 连接 JWKS 死锁
    await getActiveSigningKey();

    // 发布宽限（JWKS 轮换重叠窗口）：过期公钥在 JWKS 中保留 JWKS_PUBLISH_GRACE_SECS
    // （≥ max(AT_TTL, ID_TOKEN_TTL)），保证轮换瞬间存量 token 仍可被冷启动的
    // 验签方（Gateway）取到旧公钥；宽限外的历史密钥不再暴露
    const publishCutoff = new Date(Date.now() - JWKS_PUBLISH_GRACE_SECS * 1000);
    const rows = await db
      .select()
      .from(schema.jwks)
      .where(or(
        gt(schema.jwks.expiresAt, publishCutoff),
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
    const mapped = mapServerError(err);
    return NextResponse.json({ error: mapped.error, message: mapped.message }, { status: mapped.status });
  }
}
