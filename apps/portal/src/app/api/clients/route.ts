/**
 * Client 管理 API
 * GET /api/clients - 获取 OAuth Client 列表
 * POST /api/clients - 创建 OAuth Client
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { ilike, eq, or, desc, sql as drizzleSql } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

/**
 * 生成随机 ID
 */
function generateId(length: number = 20): string {
  return randomBytes(length).toString('hex').slice(0, length);
}

/**
 * 生成 Client ID
 */
function generateClientId(): string {
  return `client_${randomBytes(8).toString('hex')}`;
}

/**
 * 生成 Client Secret
 */
function generateClientSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * GET /api/clients
 * 获取 OAuth Client 列表
 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['client:list'] }, async () => {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const keyword = searchParams.get('keyword') || '';
    const status = searchParams.get('status') || '';

    const offset = (page - 1) * pageSize;

    // 构建条件
    const conditions = [];
    if (keyword) {
      conditions.push(
        or(
          ilike(schema.clients.name, `%${keyword}%`),
          ilike(schema.clients.clientId, `%${keyword}%`)
        )
      );
    }
    if (status && (status === 'ACTIVE' || status === 'DISABLED')) {
      conditions.push(eq(schema.clients.status, status as 'ACTIVE' | 'DISABLED'));
    }

    // 查询总数
    const countResult = await db.select({ count: drizzleSql`COUNT(*)::int` })
      .from(schema.clients)
      .where(conditions.length > 0 ? conditions.reduce((acc, c) => acc ? drizzleSql`${acc} AND ${c}` : c) : undefined);
    const total = Number(countResult[0]?.count ?? 0);

    // 查询列表
    const clients = await db.select()
      .from(schema.clients)
      .where(conditions.length > 0 ? conditions.reduce((acc, c) => acc ? drizzleSql`${acc} AND ${c}` : c) : undefined)
      .orderBy(desc(schema.clients.createdAt))
      .limit(pageSize)
      .offset(offset);

    return NextResponse.json({
      data: clients.map(c => ({
        id: c.id,
        publicId: c.publicId,
        name: c.name,
        clientId: c.clientId,
        redirectUris: JSON.parse(c.redirectUrls || '[]'),
        scopes: c.scopes,
        homepageUrl: c.homepageUrl,
        logoUrl: c.icon,
        status: c.status,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
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
 * POST /api/clients
 * 创建 OAuth Client
 */
export async function POST(request: NextRequest) {
  return withPermission(request, { permissions: ['client:create'] }, async () => {
    const body = await request.json();
    const {
      name,
      redirectUris,
      scopes = 'openid profile email',
      homepageUrl,
      logoUrl,
      accessTokenTtl = 3600,
      refreshTokenTtl = 604800,
      skipConsent = false,
    } = body;

    if (!name || !redirectUris || !Array.isArray(redirectUris) || redirectUris.length === 0) {
      return NextResponse.json(
        { error: 'invalid_params', message: '缺少必填字段: name 和 redirectUris' },
        { status: 400 }
      );
    }

    // 验证 redirectUri 格式
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

    const id = generateId(20);
    const publicId = `cli_${generateId(8)}`;
    const clientId = generateClientId();
    const clientSecret = generateClientSecret();

    await db.insert(schema.clients).values({
      id,
      publicId,
      name,
      clientId,
      clientSecret,
      redirectUrls: JSON.stringify(redirectUris),
      grantTypes: JSON.stringify(['authorization_code', 'refresh_token']),
      scopes,
      homepageUrl: homepageUrl ?? null,
      icon: logoUrl ?? null,
      accessTokenTtl,
      refreshTokenTtl,
      status: 'ACTIVE',
      disabled: false,
      skipConsent,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      data: {
        id,
        publicId,
        name,
        clientId,
        clientSecret, // 仅在创建时返回一次
        redirectUris,
        scopes,
        homepageUrl,
        logoUrl,
        accessTokenTtl,
        refreshTokenTtl,
        skipConsent,
        status: 'ACTIVE',
      },
    });
  });
}