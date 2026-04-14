/**
 * Client 详情 API
 * GET /api/clients/[id] - 获取 Client 详情
 * PUT /api/clients/[id] - 更新 Client
 * DELETE /api/clients/[id] - 删除/禁用 Client
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/clients/[id]
 * 获取 Client 详情
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['client:read'] }, async () => {
    const { id } = await params;

    const clients = await db.select()
      .from(schema.clients)
      .where(eq(schema.clients.id, id));

    if (clients.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: 'Client 不存在' },
        { status: 404 }
      );
    }

    const c = clients[0]!;

    return NextResponse.json({
      data: {
        id: c.id,
        publicId: c.publicId,
        name: c.name,
        clientId: c.clientId,
        redirectUris: JSON.parse(c.redirectUrls || '[]'),
        grantTypes: JSON.parse(c.grantTypes || '[]'),
        scopes: c.scopes,
        homepageUrl: c.homepageUrl,
        logoUrl: c.icon,
        accessTokenTtl: c.accessTokenTtl,
        refreshTokenTtl: c.refreshTokenTtl,
        status: c.status,
        disabled: c.disabled,
        skipConsent: c.skipConsent,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      },
    });
  });
}

/**
 * PUT /api/clients/[id]
 * 更新 Client
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['client:update'] }, async () => {
    const { id } = await params;
    const body = await request.json();
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

    // 验证 redirectUri 格式
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

    // 构建更新数据
    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name;
    if (redirectUris !== undefined) updateData.redirectUrls = JSON.stringify(redirectUris);
    if (scopes !== undefined) updateData.scopes = scopes;
    if (homepageUrl !== undefined) updateData.homepageUrl = homepageUrl;
    if (logoUrl !== undefined) updateData.icon = logoUrl;
    if (accessTokenTtl !== undefined) updateData.accessTokenTtl = accessTokenTtl;
    if (refreshTokenTtl !== undefined) updateData.refreshTokenTtl = refreshTokenTtl;
    if (skipConsent !== undefined) updateData.skipConsent = skipConsent;
    if (status !== undefined && (status === 'ACTIVE' || status === 'DISABLED')) {
      updateData.status = status;
      updateData.disabled = status === 'DISABLED';
    }

    await db.update(schema.clients).set(updateData).where(eq(schema.clients.id, id));

    // 查询更新后的数据
    const updated = await db.select()
      .from(schema.clients)
      .where(eq(schema.clients.id, id));

    const c = updated[0]!;

    return NextResponse.json({
      success: true,
      data: {
        id: c.id,
        publicId: c.publicId,
        name: c.name,
        clientId: c.clientId,
        redirectUris: JSON.parse(c.redirectUrls || '[]'),
        scopes: c.scopes,
        homepageUrl: c.homepageUrl,
        logoUrl: c.icon,
        accessTokenTtl: c.accessTokenTtl,
        refreshTokenTtl: c.refreshTokenTtl,
        status: c.status,
        disabled: c.disabled,
        skipConsent: c.skipConsent,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      },
    });
  });
}

/**
 * DELETE /api/clients/[id]
 * 删除或禁用 Client
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['client:delete'] }, async () => {
    const { id } = await params;
    const searchParams = request.nextUrl.searchParams;
    const mode = searchParams.get('mode') || 'disable';

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

    if (mode === 'soft') {
      await db.delete(schema.clients).where(eq(schema.clients.id, id));
      return NextResponse.json({
        success: true,
        message: `Client "${clientName}" 已删除`,
      });
    } else {
      await db.update(schema.clients)
        .set({ status: 'DISABLED', disabled: true, updatedAt: new Date() })
        .where(eq(schema.clients.id, id));

      return NextResponse.json({
        success: true,
        message: `Client "${clientName}" 已禁用`,
        data: { id, status: 'DISABLED' },
      });
    }
  });
}