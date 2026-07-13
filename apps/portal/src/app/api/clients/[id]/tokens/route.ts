/**
 * Client Token 管理 API
 * GET /api/clients/[id]/tokens — 委托 data.ts 获取 Token 列表
 * DELETE /api/clients/[id]/tokens — 撤销授权 Token
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq, inArray, and } from 'drizzle-orm';
import { withPermission, logServerDataRead } from '@/lib/auth';
import { COMMON_ERRORS } from '@auth-sso/contracts';
import { getClientById, getClientTokens } from '@/app/(dashboard)/clients/data';
import { writeAuditLog, extractClientIP, extractUserAgent } from '@/lib/audit';
import { parsePagination } from '@/lib/pagination';
import { apiError } from '@/lib/response';


interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/clients/[id]/tokens — 委托 data.ts */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: ['client:read'] }, async () => {
    const { id } = await params;

    const client = await getClientById(id);
    if (!client) {
      return apiError(COMMON_ERRORS.NOT_FOUND, 'Client 不存在', 404);
    }

    const sp = request.nextUrl.searchParams;
    const { page, pageSize } = parsePagination(sp);
    const userId = sp.get('userId') || undefined;

    const result = await getClientTokens(client.clientId, { page, pageSize, userId });
    await logServerDataRead('client_tokens', client.clientId);
    return NextResponse.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  });
}

/** DELETE /api/clients/[id]/tokens — 撤销授权 Token */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: ['client:update'] }, async (adminUserId) => {
    const { id } = await params;
    const body = await request.json();
    const { tokenIds, revokeAll } = body;

    const client = await getClientById(id);
    if (!client) {
      return apiError(COMMON_ERRORS.NOT_FOUND, 'Client 不存在', 404);
    }

    let deletedCount = 0;
    if (revokeAll) {
      const result = await db.delete(schema.accessTokens)
        .where(eq(schema.accessTokens.clientId, client.clientId))
        .returning({ id: schema.accessTokens.id });
      deletedCount = result.length;
    } else if (tokenIds && Array.isArray(tokenIds) && tokenIds.length > 0) {
      const result = await db.delete(schema.accessTokens)
        .where(and(eq(schema.accessTokens.clientId, client.clientId), inArray(schema.accessTokens.id, tokenIds)))
        .returning({ id: schema.accessTokens.id });
      deletedCount = result.length;
    } else {
      return apiError(COMMON_ERRORS.VALIDATION_ERROR, '请提供 tokenIds 或 revokeAll', 400);
    }

    writeAuditLog({
      userId: adminUserId,
      operation: 'TOKEN_REVOKE',
      method: 'DELETE',
      url: request.url,
      params: { 
        targetId: client.clientId,
        targetName: client.name,
        revokeAll, 
        tokenIds, 
        revokedCount: deletedCount 
      },
      ip: extractClientIP(request.headers),
      userAgent: extractUserAgent(request.headers),
      status: 200,
    });

    return NextResponse.json({ success: true, message: `已撤销 ${deletedCount} 个 Token`, data: { revokedCount: deletedCount } });
  });
}
