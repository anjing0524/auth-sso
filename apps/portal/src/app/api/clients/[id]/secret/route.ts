/**
 * Client Secret 管理 API
 * POST /api/clients/[id]/secret - 重新生成 Client Secret
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { randomBytes } from 'crypto';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * 生成 Client Secret
 * 64位十六进制字符串，足够安全
 * @returns 随机生成的 Secret
 */
function generateClientSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * POST /api/clients/[id]/secret
 * 重新生成 Client Secret
 * 权限要求: client:update
 *
 * 注意：
 * - 新 Secret 立即生效
 * - 旧 Secret 立即失效
 * - 新 Secret 仅返回一次，请妥善保存
 *
 * @param request - Next.js request 对象
 * @param params - 路由参数，包含 Client ID
 * @returns JSON 响应，包含新的 clientSecret
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['client:update'] }, async () => {
    const { id } = await params;

    // 检查 Client 是否存在
    const existing = await sql`
      SELECT id, name FROM clients WHERE id = ${id}
    `;

    if (existing.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: 'Client 不存在' },
        { status: 404 }
      );
    }

    const clientName = existing[0].name;

    // 生成新的 Secret
    const newSecret = generateClientSecret();

    // 更新 Client Secret
    await sql`
      UPDATE clients
      SET client_secret = ${newSecret}, updated_at = NOW()
      WHERE id = ${id}
    `;

    return NextResponse.json({
      success: true,
      message: `Client "${clientName}" 的 Secret 已重新生成`,
      data: {
        clientSecret: newSecret, // 仅返回一次！
      },
    });
  });
}