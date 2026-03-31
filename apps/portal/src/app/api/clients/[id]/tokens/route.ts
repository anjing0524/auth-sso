/**
 * Client Token 管理 API
 * GET /api/clients/[id]/tokens - 获取 Client 的授权 Token 列表
 * DELETE /api/clients/[id]/tokens - 撤销授权 Token
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/clients/[id]/tokens
 * 获取 Client 的授权 Token 列表
 * 权限要求: client:read
 *
 * Query 参数:
 * - page: 页码，默认 1
 * - pageSize: 每页数量，默认 20
 * - userId: 按用户筛选（可选）
 *
 * @param request - Next.js request 对象
 * @param params - 路由参数，包含 Client ID
 * @returns JSON 响应，包含 Token 列表和分页信息
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
    const client = await sql`
      SELECT id FROM clients WHERE id = ${id}
    `;

    if (client.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: 'Client 不存在' },
        { status: 404 }
      );
    }

    // 构建查询条件
    const conditions: string[] = [`client_id = '${id}'`];
    if (userId) {
      conditions.push(`user_id = '${userId.replace(/'/g, "''")}'`);
    }
    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // 查询总数
    const countResult = await sql`
      SELECT COUNT(*) as total FROM oauth_access_tokens ${sql.unsafe(whereClause)}
    `;
    const total = parseInt(countResult[0]?.total || '0', 10);

    // 查询 Token 列表，关联用户信息
    const tokens = await sql`
      SELECT
        t.id,
        t.user_id,
        t.scopes,
        t.created_at,
        t.expires_at,
        u.email as user_email,
        u.name as user_name
      FROM oauth_access_tokens t
      LEFT JOIN users u ON t.user_id = u.id
      ${sql.unsafe(whereClause)}
      ORDER BY t.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    return NextResponse.json({
      data: tokens.map((t: any) => ({
        id: t.id,
        userId: t.user_id,
        username: t.user_email || t.user_name,
        scopes: JSON.parse(t.scopes || '[]'),
        createdAt: t.created_at,
        expiresAt: t.expires_at,
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
 * 权限要求: client:update
 *
 * 请求体:
 * - tokenIds: 要撤销的 Token ID 数组
 * - revokeAll: 是否撤销所有 Token（布尔值）
 *
 * @param request - Next.js request 对象
 * @param params - 路由参数，包含 Client ID
 * @returns JSON 响应，包含撤销结果
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['client:update'] }, async () => {
    const { id } = await params;
    const body = await request.json();
    const { tokenIds, revokeAll } = body;

    // 检查 Client 是否存在
    const client = await sql`
      SELECT id FROM clients WHERE id = ${id}
    `;

    if (client.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: 'Client 不存在' },
        { status: 404 }
      );
    }

    let deletedCount = 0;

    if (revokeAll) {
      // 撤销所有 Token
      const result = await sql`
        DELETE FROM oauth_access_tokens
        WHERE client_id = ${id}
        RETURNING id
      `;
      deletedCount = result.length;
    } else if (tokenIds && Array.isArray(tokenIds) && tokenIds.length > 0) {
      // 撤销指定 Token
      const idsList = tokenIds.map(id => `'${id.replace(/'/g, "''")}'`).join(', ');
      const result = await sql`
        DELETE FROM oauth_access_tokens
        WHERE client_id = ${id} AND id IN (${sql.unsafe(idsList)})
        RETURNING id
      `;
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
      data: {
        revokedCount: deletedCount,
      },
    });
  });
}