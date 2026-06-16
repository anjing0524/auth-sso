/**
 * Client Secret 管理 API
 * POST /api/clients/[id]/secret - 重新生成 Client Secret
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { withPermission } from '@/lib/auth';
import { generateClientSecret } from '@/lib/crypto';
import { COMMON_ERRORS } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * 路由动态参数接口定义
 */
interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/clients/[id]/secret
 * 重新生成 Client Secret
 * 权限要求: client:update
 *
 * @param request NextRequest 对象
 * @param params 动态路由参数客户端 ID
 * @returns 包含全新 Client Secret 的成功状态响应
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  return withPermission(request, { permissions: ['client:update'] }, async () => {
    try {
      const { id } = await params;

      // 检查 Client 是否存在
      const existing = await db.select()
        .from(schema.clients)
        .where(eq(schema.clients.id, id));

      if (existing.length === 0) {
        return NextResponse.json(
          { error: COMMON_ERRORS.NOT_FOUND, message: 'Client 不存在' },
          { status: 404 }
        );
      }

      const clientName = existing[0]!.name;
      // 废止局部手写 secret 生成，复用全局统一的 crypto 工具
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
    } catch (error) {
      console.error('[ClientSecret POST] Failed to reset client secret:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '重置 Client Secret 失败' },
        { status: 500 }
      );
    }
  });
}