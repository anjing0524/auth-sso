/**
 * Client Token 管理 API
 * GET /api/clients/[id]/tokens - 获取 Client 的授权 Token 列表
 * DELETE /api/clients/[id]/tokens - 撤销授权 Token
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, inArray, desc, sql as drizzleSql } from 'drizzle-orm';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/clients/[id]/tokens
 * 获取 Client 的授权 Token 列表
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['client:read'] }, async () => {
    const { id } = await params;
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const userId = searchParams.get('userId') || '';

    const offset = (page - 1) * pageSize;

    // 检查 Client 是否存在
    const client = await db.select()
      .from(schema.clients)
      .where(eq(schema.clients.id, id));

    if (client.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: 'Client 不存在' },
        { status: 404 }
      );
    }

    // 构建条件
    const conditions = [eq(schema.oauthAccessTokens.clientId, id)];
    if (userId) {
      conditions.push(eq(schema.oauthAccessTokens.userId, userId));
    }

    // 查询总数
    const countResult = await db.select({ count: drizzleSql`COUNT(*)::int` })
      .from(schema.oauthAccessTokens)
      .where(drizzleSql`${conditions.join(' AND ')}`);
    const total = Number(countResult[0]?.count ?? 0);

    // 查询 Token 列表
    const tokens = await db.select({
      id: schema.oauthAccessTokens.id,
      userId: schema.oauthAccessTokens.userId,
      scopes: schema.oauthAccessTokens.scopes,
      createdAt: schema.oauthAccessTokens.createdAt,
      expiresAt: schema.oauthAccessTokens.expiresAt,
      userEmail: schema.users.email,
      userName: schema.users.name,
    })
    .from(schema.oauthAccessTokens)
    .leftJoin(schema.users, eq(schema.oauthAccessTokens.userId, schema.users.id))
    .where(drizzleSql`${conditions.join(' AND ')}`)
    .orderBy(desc(schema.oauthAccessTokens.createdAt))
    .limit(pageSize)
    .offset(offset);

    return NextResponse.json({
      data: tokens.map(t => ({
        id: t.id,
        userId: t.userId,
        username: t.userEmail || t.userName,
        scopes: JSON.parse(t.scopes || '[]'),
        createdAt: t.createdAt,
        expiresAt: t.expiresAt,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  });
}

/**
 * DELETE /api/clients/[id]/tokens
 * 撤销授权 Token
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['client:update'] }, async () => {
    const { id } = await params;
    const body = await request.json();
    const { tokenIds, revokeAll } = body;

    // 检查 Client 是否存在
    const client = await db.select()
      .from(schema.clients)
      .where(eq(schema.clients.id, id));

    if (client.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: 'Client 不存在' },
        { status: 404 }
      );
    }

    let deletedCount = 0;

    if (revokeAll) {
      const result = await db.delete(schema.oauthAccessTokens)
        .where(eq(schema.oauthAccessTokens.clientId, id))
        .returning({ id: schema.oauthAccessTokens.id });
      deletedCount = result.length;
    } else if (tokenIds && Array.isArray(tokenIds) && tokenIds.length > 0) {
      const result = await db.delete(schema.oauthAccessTokens)
        .where(inArray(schema.oauthAccessTokens.id, tokenIds))
        .returning({ id: schema.oauthAccessTokens.id });
      deletedCount = result.length;
    } else {
      return NextResponse.json(
        { error: 'invalid_params', message: '请提供 tokenIds 或 revokeAll' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `已撤销 ${deletedCount} 个 Token`,
      data: { revokedCount: deletedCount },
    });
  });
}