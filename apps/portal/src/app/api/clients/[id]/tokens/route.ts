/**
 * Client Token 管理 API
 * GET /api/clients/[id]/tokens - 获取 Client 的授权 Token 列表
 * DELETE /api/clients/[id]/tokens - 撤销授权 Token
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq, inArray, desc, and, sql } from 'drizzle-orm';
import { withPermission } from '@/lib/auth';
import { COMMON_ERRORS } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * 路由动态参数接口定义
 */
interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/clients/[id]/tokens
 * 获取指定客户端的授权 Token 列表 (支持分页和按用户过滤)
 * 权限要求: client:read
 *
 * @param request NextRequest 对象
 * @param params 动态路由参数客户端 ID
 * @returns 授权 Token 分页列表数据
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  return withPermission(request, { permissions: ['client:read'] }, async () => {
    try {
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
          { error: COMMON_ERRORS.NOT_FOUND, message: 'Client 不存在' },
          { status: 404 }
        );
      }

      // 构建查询条件组
      const conditions = [eq(schema.oauthAccessTokens.clientId, id)];
      if (userId) {
        conditions.push(eq(schema.oauthAccessTokens.userId, userId));
      }

      // 查询总数 (🔥已修复：废除 SQL Object 的 join(' AND ') 混淆拼装，改用 Drizzle 原生 type-safe and 表达式)
      const countResult = await db.select({ count: sql`COUNT(*)::int` })
        .from(schema.oauthAccessTokens)
        .where(and(...conditions));
      const total = Number(countResult[0]?.count ?? 0);

      // 查询 Token 列表 (🔥已修复：废除 join(' AND ') 拼装，改用 Drizzle 原生 type-safe and 表达式)
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
      .where(and(...conditions))
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
    } catch (error) {
      console.error('[ClientTokens GET] Failed to retrieve tokens:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '获取客户端 Token 列表失败' },
        { status: 500 }
      );
    }
  });
}

/**
 * DELETE /api/clients/[id]/tokens
 * 撤销授权 Token (引入 try-catch 保护与 tokenIds 作用范围的 clientId 安全校验)
 * 权限要求: client:update
 *
 * @param request NextRequest 对象
 * @param params 动态路由参数客户端 ID
 * @returns 撤销结果响应
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  return withPermission(request, { permissions: ['client:update'] }, async () => {
    try {
      const { id } = await params;
      const body = await request.json();
      const { tokenIds, revokeAll } = body;

      // 检查 Client 是否存在
      const client = await db.select()
        .from(schema.clients)
        .where(eq(schema.clients.id, id));

      if (client.length === 0) {
        return NextResponse.json(
          { error: COMMON_ERRORS.NOT_FOUND, message: 'Client 不存在' },
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
        // 🔥安全加固：限制删除的 Token 必须归属于当前 Client ID，防止越权撤销其他 Client 的 Token
        const result = await db.delete(schema.oauthAccessTokens)
          .where(and(
            eq(schema.oauthAccessTokens.clientId, id),
            inArray(schema.oauthAccessTokens.id, tokenIds)
          ))
          .returning({ id: schema.oauthAccessTokens.id });
        deletedCount = result.length;
      } else {
        return NextResponse.json(
          { error: COMMON_ERRORS.VALIDATION_ERROR, message: '请提供 tokenIds 或 revokeAll' },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        message: `已撤销 ${deletedCount} 个 Token`,
        data: { revokedCount: deletedCount },
      });
    } catch (error) {
      console.error('[ClientTokens DELETE] Failed to revoke tokens:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '撤销 Token 失败' },
        { status: 500 }
      );
    }
  });
}