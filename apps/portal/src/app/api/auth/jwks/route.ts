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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await db
      .select()
      .from(schema.jwks)
      .orderBy(schema.jwks.createdAt);

    if (rows.length === 0) {
      return NextResponse.json({ keys: [] });
    }

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
    console.error('[JWKS] 获取公钥失败:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: '获取公钥失败' }, { status: 500 });
  }
}
