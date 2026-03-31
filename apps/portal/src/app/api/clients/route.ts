/**
 * Client 管理 API
 * GET /api/clients - 获取 OAuth Client 列表
 * POST /api/clients - 创建 OAuth Client
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { randomBytes } from 'crypto';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

/**
 * 生成随机 ID
 * @param length - ID 长度，默认 20
 * @returns 随机生成的十六进制字符串
 */
function generateId(length: number = 20): string {
  return randomBytes(length).toString('hex').slice(0, length);
}

/**
 * 生成 Client ID
 * 格式: client_xxxxxxxx (client_ + 16位十六进制)
 * @returns 格式化的 Client ID
 */
function generateClientId(): string {
  return `client_${randomBytes(8).toString('hex')}`;
}

/**
 * 生成 Client Secret
 * 64位十六进制字符串，足够安全
 * @returns 随机生成的 Secret
 */
function generateClientSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * GET /api/clients
 * 获取 OAuth Client 列表
 * 权限要求: client:list
 *
 * Query 参数:
 * - page: 页码，默认 1
 * - pageSize: 每页数量，默认 20
 * - keyword: 搜索关键词（名称、Client ID）
 * - status: 状态筛选（ACTIVE/DISABLED）
 *
 * @param request - Next.js request 对象
 * @returns JSON 响应，包含 data 数组和 pagination 对象
 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['client:list'] }, async () => {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const keyword = searchParams.get('keyword') || '';
    const status = searchParams.get('status') || '';

    const offset = (page - 1) * pageSize;

    // 构建查询条件（使用参数化查询避免 SQL 注入）
    const conditions: string[] = [];
    if (keyword) {
      conditions.push(`(name ILIKE '%${keyword.replace(/'/g, "''")}%' OR client_id ILIKE '%${keyword.replace(/'/g, "''")}%')`);
    }
    if (status && (status === 'ACTIVE' || status === 'DISABLED')) {
      conditions.push(`status = '${status}'`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 查询总数
    const countResult = await sql`
      SELECT COUNT(*) as total FROM clients ${sql.unsafe(whereClause)}
    `;
    const total = parseInt(countResult[0]?.total || '0', 10);

    // 查询 Client 列表
    const clients = await sql`
      SELECT
        id,
        public_id,
        name,
        client_id,
        redirect_uris,
        scopes,
        homepage_url,
        logo_url,
        status,
        created_at,
        updated_at
      FROM clients
      ${sql.unsafe(whereClause)}
      ORDER BY created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    return NextResponse.json({
      data: clients.map((c: any) => ({
        id: c.id,
        publicId: c.public_id,
        name: c.name,
        clientId: c.client_id,
        redirectUris: JSON.parse(c.redirect_uris || '[]'),
        scopes: c.scopes,
        homepageUrl: c.homepage_url,
        logoUrl: c.logo_url,
        status: c.status,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
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
 * 权限要求: client:create
 *
 * 请求体:
 * - name: Client 名称（必填）
 * - redirectUris: 回调地址数组（必填）
 * - scopes: 支持的 scopes，空格分隔（可选，默认 openid profile email）
 * - homepageUrl: 应用主页 URL（可选）
 * - logoUrl: 应用 Logo URL（可选）
 * - accessTokenTtl: Access Token 有效期（秒）（可选，默认 3600）
 * - refreshTokenTtl: Refresh Token 有效期（秒）（可选，默认 604800）
 * - skipConsent: 是否跳过授权确认（可选，默认 false）
 *
 * @param request - Next.js request 对象
 * @returns JSON 响应，包含创建的 Client 信息（client_secret 仅返回一次）
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

    // 验证必填字段
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

    // 生成 ID 和凭证
    const id = generateId(20);
    const publicId = `cli_${generateId(8)}`;
    const clientId = generateClientId();
    const clientSecret = generateClientSecret();

    // 创建 Client
    await sql`
      INSERT INTO clients (
        id, public_id, name, client_id, client_secret,
        redirect_uris, grant_types, scopes,
        homepage_url, logo_url,
        access_token_ttl, refresh_token_ttl,
        status, disabled, skip_consent,
        created_at, updated_at
      ) VALUES (
        ${id}, ${publicId}, ${name}, ${clientId}, ${clientSecret},
        ${JSON.stringify(redirectUris)}, ${JSON.stringify(['authorization_code', 'refresh_token'])}, ${scopes},
        ${homepageUrl || null}, ${logoUrl || null},
        ${accessTokenTtl}, ${refreshTokenTtl},
        'ACTIVE', false, ${skipConsent},
        NOW(), NOW()
      )
    `;

    return NextResponse.json({
      success: true,
      data: {
        id,
        publicId,
        name,
        clientId,
        clientSecret, // 仅在创建时返回一次！
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