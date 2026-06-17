/**
 * Client Token 管理 API
 * GET /api/clients/[id]/tokens — 委托 data.ts 获取 Token 列表
 * DELETE /api/clients/[id]/tokens — 撤销授权 Token
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq, inArray, and } from 'drizzle-orm';
import { withPermission } from '@/lib/auth';
import { COMMON_ERRORS } from '@auth-sso/contracts';
import { getClientById, getClientTokens } from '@/app/(dashboard)/clients/data';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/clients/[id]/tokens — 委托 data.ts */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['client:read'] }, async () => {
    const { id } = await params;

    const client = await getClientById(id);
    if (!client) {
      return NextResponse.json({ error: COMMON_ERRORS.NOT_FOUND, message: 'Client 不存在' }, { status: 404 });
    }

    const sp = request.nextUrl.searchParams;
    const page = parseInt(sp.get('page') || '1', 10);
    const pageSize = parseInt(sp.get('pageSize') || '20', 10);
    const userId = sp.get('userId') || undefined;

    const result = await getClientTokens(client.id, { page, pageSize, userId });
    return NextResponse.json(result);
  });
}

/** DELETE /api/clients/[id]/tokens — 撤销授权 Token */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['client:update'] }, async () => {
    const { id } = await params;
    const body = await request.json();
    const { tokenIds, revokeAll } = body;

    const client = await getClientById(id);
    if (!client) {
      return NextResponse.json({ error: COMMON_ERRORS.NOT_FOUND, message: 'Client 不存在' }, { status: 404 });
    }

    let deletedCount = 0;
    if (revokeAll) {
      const result = await db.delete(schema.accessTokens)
        .where(eq(schema.accessTokens.clientId, client.id))
        .returning({ id: schema.accessTokens.id });
      deletedCount = result.length;
    } else if (tokenIds && Array.isArray(tokenIds) && tokenIds.length > 0) {
      const result = await db.delete(schema.accessTokens)
        .where(and(eq(schema.accessTokens.clientId, client.id), inArray(schema.accessTokens.id, tokenIds)))
        .returning({ id: schema.accessTokens.id });
      deletedCount = result.length;
    } else {
      return NextResponse.json({ error: COMMON_ERRORS.VALIDATION_ERROR, message: '请提供 tokenIds 或 revokeAll' }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: `已撤销 ${deletedCount} 个 Token`, data: { revokedCount: deletedCount } });
  });
}
