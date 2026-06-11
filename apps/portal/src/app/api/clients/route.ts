/**
 * OAuth 客户端管理 API 路由处理器
 * GET /api/clients - 获取 OAuth Client 列表
 * POST /api/clients - 创建 OAuth Client
 * 
 * @module apps/portal/api/clients
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { ilike, eq, or, desc, and, sql as drizzleSql } from 'drizzle-orm';
import { withPermission } from '@/lib/auth-middleware';
import { generateId, generateClientId, generateClientSecret } from '@/lib/crypto';
import { COMMON_ERRORS, CLIENT_ERRORS, EntityStatus } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * GET /api/clients
 * 获取 OAuth Client 列表
 * 权限要求: client:list
 * 
 * @param request Next.js 请求对象
 * @returns 客户端列表及分页 JSON 响应
 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['client:list'] }, async () => {
    try {
      const searchParams = request.nextUrl.searchParams;
      const page = parseInt(searchParams.get('page') || '1', 10);
      const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
      const keyword = searchParams.get('keyword') || '';
      const status = searchParams.get('status') || '';

      const offset = (page - 1) * pageSize;

      // 构建条件数组，消除类型强转，符合代码整洁之道
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
        conditions.push(eq(schema.clients.status, status));
      }

      // 查询总数
      const countResult = await db.select({ count: drizzleSql`COUNT(*)::int` })
        .from(schema.clients)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
      const total = Number(countResult[0]?.count ?? 0);

      // 查询列表
      const clients = await db.select()
        .from(schema.clients)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(schema.clients.createdAt))
        .limit(pageSize)
        .offset(offset);

      return NextResponse.json({
        data: clients.map(c => {
          let redirectUris: string[] = [];
          try {
            if (c.redirectUrls.startsWith('[')) {
              redirectUris = JSON.parse(c.redirectUrls);
            } else {
              redirectUris = c.redirectUrls.split(',').map(u => u.trim());
            }
          } catch (e) {
            redirectUris = [c.redirectUrls];
          }

          return {
            id: c.id,
            publicId: c.publicId,
            name: c.name,
            clientId: c.clientId,
            redirectUris,
            scopes: c.scopes,
            homepageUrl: c.homepageUrl,
            logoUrl: c.icon,
            status: c.status,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
          };
        }),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      });
    } catch (error) {
      console.error('[Clients GET] Failed to fetch clients list:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '系统内部错误' },
        { status: 500 }
      );
    }
  });
}

/**
 * POST /api/clients
 * 创建 OAuth Client
 * 权限要求: client:create
 * 
 * @param request Next.js 请求对象
 * @returns 创建成功的客户端信息 (包括 ClientSecret，仅返回一次)
 */
export async function POST(request: NextRequest) {
  return withPermission(request, { permissions: ['client:create'] }, async () => {
    try {
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
          { error: COMMON_ERRORS.VALIDATION_ERROR, message: '缺少必填字段: name 和 redirectUris' },
          { status: 400 }
        );
      }

      // 验证 redirectUri 格式
      for (const uri of redirectUris) {
        try {
          new URL(uri);
        } catch {
          return NextResponse.json(
            { error: CLIENT_ERRORS.INVALID_REDIRECT_URI, message: `无效的回调地址: ${uri}` },
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
          status: 'ACTIVE' as EntityStatus,
        },
      });
    } catch (error) {
      console.error('[Clients POST] Failed to create client:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '系统内部错误' },
        { status: 500 }
      );
    }
  });
}