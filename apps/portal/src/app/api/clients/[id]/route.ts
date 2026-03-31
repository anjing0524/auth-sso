/**
 * Client 详情 API
 * GET /api/clients/[id] - 获取 Client 详情
 * PUT /api/clients/[id] - 更新 Client
 * DELETE /api/clients/[id] - 删除/禁用 Client
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/clients/[id]
 * 获取 Client 详情
 * 权限要求: client:read
 *
 * @param request - Next.js request 对象
 * @param params - 路由参数，包含 Client ID
 * @returns JSON 响应，包含 Client 详细信息（不含 client_secret）
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['client:read'] }, async () => {
    const { id } = await params;

    // 查询 Client 详情
    const clients = await sql`
      SELECT
        id,
        public_id,
        name,
        client_id,
        redirect_uris,
        grant_types,
        scopes,
        homepage_url,
        logo_url,
        access_token_ttl,
        refresh_token_ttl,
        status,
        disabled,
        skip_consent,
        created_at,
        updated_at
      FROM clients
      WHERE id = ${id}
    `;

    if (clients.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: 'Client 不存在' },
        { status: 404 }
      );
    }

    const c = clients[0];

    return NextResponse.json({
      data: {
        id: c.id,
        publicId: c.public_id,
        name: c.name,
        clientId: c.client_id,
        redirectUris: JSON.parse(c.redirect_uris || '[]'),
        grantTypes: JSON.parse(c.grant_types || '[]'),
        scopes: c.scopes,
        homepageUrl: c.homepage_url,
        logoUrl: c.logo_url,
        accessTokenTtl: c.access_token_ttl,
        refreshTokenTtl: c.refresh_token_ttl,
        status: c.status,
        disabled: c.disabled,
        skipConsent: c.skip_consent,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      },
    });
  });
}

/**
 * PUT /api/clients/[id]
 * 更新 Client 信息
 * 权限要求: client:update
 *
 * 请求体（可更新字段）:
 * - name: Client 名称
 * - redirectUris: 回调地址数组
 * - scopes: 支持的 scopes
 * - homepageUrl: 应用主页 URL
 * - logoUrl: 应用 Logo URL
 * - accessTokenTtl: Access Token 有效期
 * - refreshTokenTtl: Refresh Token 有效期
 * - skipConsent: 是否跳过授权确认
 * - status: 状态（ACTIVE/DISABLED）
 *
 * @param request - Next.js request 对象
 * @param params - 路由参数，包含 Client ID
 * @returns JSON 响应，包含更新后的 Client 信息
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['client:update'] }, async () => {
    const { id } = await params;
    const body = await request.json();

    // 检查 Client 是否存在
    const existing = await sql`
      SELECT id FROM clients WHERE id = ${id}
    `;

    if (existing.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: 'Client 不存在' },
        { status: 404 }
      );
    }

    const {
      name,
      redirectUris,
      scopes,
      homepageUrl,
      logoUrl,
      accessTokenTtl,
      refreshTokenTtl,
      skipConsent,
      status,
    } = body;

    // 验证 redirectUri 格式（如果提供）
    if (redirectUris && Array.isArray(redirectUris)) {
      for (const uri of redirectUris) {
        try {
          new URL(uri);
        } catch {
          return NextResponse.json(
            { error: 'invalid_redirect_uri', message: `无效的 redirect URI: ${uri}` },
            { status: 400 }
          );
        }
      }
    }

    // 构建动态更新语句
    const updates: string[] = [];

    if (name !== undefined) {
      updates.push(`name = '${name.replace(/'/g, "''")}'`);
    }
    if (redirectUris !== undefined) {
      updates.push(`redirect_uris = '${JSON.stringify(redirectUris).replace(/'/g, "''")}'`);
    }
    if (scopes !== undefined) {
      updates.push(`scopes = '${scopes.replace(/'/g, "''")}'`);
    }
    if (homepageUrl !== undefined) {
      updates.push(`homepage_url = ${homepageUrl ? `'${homepageUrl.replace(/'/g, "''")}'` : 'NULL'}`);
    }
    if (logoUrl !== undefined) {
      updates.push(`logo_url = ${logoUrl ? `'${logoUrl.replace(/'/g, "''")}'` : 'NULL'}`);
    }
    if (accessTokenTtl !== undefined) {
      updates.push(`access_token_ttl = ${accessTokenTtl}`);
    }
    if (refreshTokenTtl !== undefined) {
      updates.push(`refresh_token_ttl = ${refreshTokenTtl}`);
    }
    if (skipConsent !== undefined) {
      updates.push(`skip_consent = ${skipConsent}`);
    }
    if (status !== undefined && (status === 'ACTIVE' || status === 'DISABLED')) {
      updates.push(`status = '${status}'`);
      updates.push(`disabled = ${status === 'DISABLED'}`);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'no_updates', message: '没有需要更新的字段' },
        { status: 400 }
      );
    }

    // 添加 updated_at
    updates.push('updated_at = NOW()');

    // 执行更新
    const updateClause = updates.join(', ');
    await sql`
      UPDATE clients
      SET ${sql.unsafe(updateClause)}
      WHERE id = ${id}
    `;

    // 查询更新后的数据
    const updated = await sql`
      SELECT
        id, public_id, name, client_id, redirect_uris, scopes,
        homepage_url, logo_url, access_token_ttl, refresh_token_ttl,
        status, disabled, skip_consent, created_at, updated_at
      FROM clients
      WHERE id = ${id}
    `;

    const c = updated[0];

    return NextResponse.json({
      success: true,
      data: {
        id: c.id,
        publicId: c.public_id,
        name: c.name,
        clientId: c.client_id,
        redirectUris: JSON.parse(c.redirect_uris || '[]'),
        scopes: c.scopes,
        homepageUrl: c.homepage_url,
        logoUrl: c.logo_url,
        accessTokenTtl: c.access_token_ttl,
        refreshTokenTtl: c.refresh_token_ttl,
        status: c.status,
        disabled: c.disabled,
        skipConsent: c.skip_consent,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      },
    });
  });
}

/**
 * DELETE /api/clients/[id]
 * 删除或禁用 Client
 * 权限要求: client:delete
 *
 * Query 参数:
 * - mode: 删除模式（soft/disable），默认 disable
 *
 * @param request - Next.js request 对象
 * @param params - 路由参数，包含 Client ID
 * @returns JSON 响应，包含操作结果
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['client:delete'] }, async () => {
    const { id } = await params;
    const searchParams = request.nextUrl.searchParams;
    const mode = searchParams.get('mode') || 'disable';

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

    if (mode === 'soft') {
      // 硬删除（谨慎使用）
      await sql`
        DELETE FROM clients WHERE id = ${id}
      `;

      return NextResponse.json({
        success: true,
        message: `Client "${clientName}" 已删除`,
      });
    } else {
      // 默认：禁用 Client（推荐）
      await sql`
        UPDATE clients
        SET status = 'DISABLED', disabled = true, updated_at = NOW()
        WHERE id = ${id}
      `;

      return NextResponse.json({
        success: true,
        message: `Client "${clientName}" 已禁用`,
        data: { id, status: 'DISABLED' },
      });
    }
  });
}