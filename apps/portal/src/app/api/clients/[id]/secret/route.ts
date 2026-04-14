/**
 * Client Secret 管理 API
 * POST /api/clients/[id]/secret - 重新生成 Client Secret
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * 生成 Client Secret
 */
function generateClientSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * POST /api/clients/[id]/secret
 * 重新生成 Client Secret
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['client:update'] }, async () => {
    const { id } = await params;

    // 检查 Client 是否存在
    const existing = await db.select()
      .from(schema.clients)
      .where(eq(schema.clients.id, id));

    if (existing.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: 'Client 不存在' },
        { status: 404 }
      );
    }

    const clientName = existing[0]!.name;
    const newSecret = generateClientSecret();

    await db.update(schema.clients)
      .set({ clientSecret: newSecret, updatedAt: new Date() })
      .where(eq(schema.clients.id, id));

    return NextResponse.json({
      success: true,
      message: `Client "${clientName}" 的 Secret 已重新生成`,
      data: {
        clientSecret: newSecret, // 仅返回一次
      },
    });
  });
}