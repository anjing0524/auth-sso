/**
 * Client Token 管理 API
 * GET /api/clients/[id]/tokens — 委托 data.ts 获取 Token 列表
 * DELETE /api/clients/[id]/tokens — 撤销授权 Token
 */
import { type NextRequest } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq, inArray, and, isNull } from 'drizzle-orm';
import { withPermission, logServerDataRead } from '@/lib/auth';
import { CLIENT_PERMISSIONS, COMMON_ERRORS } from '@auth-sso/contracts';
import { getClientById, getClientTokens } from '@/app/(dashboard)/clients/data';
import { appendSecurityAudit, extractClientIP, extractUserAgent } from '@/lib/audit';
import { parsePagination } from '@/lib/pagination';
import { restSuccess, restListSuccess, restError } from '@/lib/response';


interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/clients/[id]/tokens — 委托 data.ts */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: [CLIENT_PERMISSIONS.READ] }, async () => {
    const { id } = await params;

    const client = await getClientById(id);
    if (!client) {
      return restError(COMMON_ERRORS.NOT_FOUND, 'Client 不存在', 404);
    }

    const sp = request.nextUrl.searchParams;
    const { page, pageSize } = parsePagination(sp);
    const userId = sp.get('userId') || undefined;

    const result = await getClientTokens(client.clientId, { page, pageSize, userId });
    await logServerDataRead('client_tokens', client.clientId);
    return restListSuccess(result.data, result.pagination);
  });
}

/** DELETE /api/clients/[id]/tokens — 撤销授权 Token */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: [CLIENT_PERMISSIONS.UPDATE] }, async (adminUserId) => {
    const { id } = await params;
    const body = await request.json();
    const { tokenIds, revokeAll } = body;

    const client = await getClientById(id);
    if (!client) {
      return restError(COMMON_ERRORS.NOT_FOUND, 'Client 不存在', 404);
    }

    if (!revokeAll && (!tokenIds || !Array.isArray(tokenIds) || tokenIds.length === 0)) {
      return restError(COMMON_ERRORS.VALIDATION_ERROR, '请提供 tokenIds 或 revokeAll', 400);
    }

    // AT 无 client 语义（ADR-006 最小化），按 client 撤销的对象是 RT（授权家族）：
    // 撤 RT 终止续期能力，已发 AT 在 ≤1h TTL 内自然失效（audit 2026-09-28 H-2 修复）
    const revokedCount = await db.transaction(async (tx) => {
      const result = revokeAll
        ? await tx.update(schema.refreshTokens).set({ revoked: new Date() })
            .where(and(eq(schema.refreshTokens.clientId, client.clientId), isNull(schema.refreshTokens.revoked)))
            .returning({ id: schema.refreshTokens.id })
        : await tx.update(schema.refreshTokens).set({ revoked: new Date() })
            .where(and(
              eq(schema.refreshTokens.clientId, client.clientId),
              inArray(schema.refreshTokens.id, tokenIds),
              isNull(schema.refreshTokens.revoked),
            ))
            .returning({ id: schema.refreshTokens.id });
      await appendSecurityAudit(tx, {
        userId: adminUserId,
        operation: 'TOKEN_REVOKE',
        method: 'DELETE',
        url: request.url,
        params: { targetId: client.clientId, targetName: client.name, revokeAll, tokenIds, revokedCount: result.length },
        ip: extractClientIP(request.headers),
        userAgent: extractUserAgent(request.headers),
        status: 200,
      });
      return result.length;
    });

    return restSuccess({ message: `已撤销 ${revokedCount} 个 Token`, data: { revokedCount } });
  });
}
