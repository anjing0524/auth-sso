/**
 * OAuth 客户端详情与操作 API 路由处理器
 * GET /api/clients/[id] - 获取 Client 详情
 * PUT /api/clients/[id] - 更新 Client
 * DELETE /api/clients/[id] - 删除/禁用 Client
 * 
 * @module apps/portal/api/clients/[id]
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { withPermission } from '@/lib/auth';
import { COMMON_ERRORS, CLIENT_ERRORS, EntityStatus } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * 路由参数定义
 */
interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * 客户端更新数据载荷接口
 */
interface ClientUpdatePayload {
  name?: string;
  redirectUrls?: string;
  scopes?: string;
  homepageUrl?: string | null;
  icon?: string | null;
  accessTokenTtl?: number;
  refreshTokenTtl?: number;
  skipConsent?: boolean;
  status?: 'ACTIVE' | 'DISABLED';
  disabled?: boolean;
  updatedAt: Date;
}

/**
 * GET /api/clients/[id]
 * 获取特定客户端的详细信息
 * 权限要求: client:read
 * 
 * @param request Next.js 请求对象
 * @param params 路由参数 (Promise<{ id: string }>)
 * @returns 客户端详情 JSON 响应
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['client:read'] }, async () => {
    try {
      const { id } = await params;

      const clients = await db.select()
        .from(schema.clients)
        .where(eq(schema.clients.id, id));

      if (clients.length === 0) {
        return NextResponse.json(
          { error: CLIENT_ERRORS.CLIENT_NOT_FOUND, message: 'Client 不存在' },
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
    } catch (error) {
      console.error('[Client Detail GET] Failed to fetch client details:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '系统内部错误' },
        { status: 500 }
      );
    }
  });
}

/**
 * PUT /api/clients/[id]
 * 更新客户端配置属性
 * 权限要求: client:update
 * 
 * @param request Next.js 请求对象
 * @param params 路由参数 (Promise<{ id: string }>)
 * @returns 更新后的客户端详情 JSON 响应
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['client:update'] }, async () => {
    try {
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
          { error: CLIENT_ERRORS.CLIENT_NOT_FOUND, message: 'Client 不存在' },
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
              { error: CLIENT_ERRORS.INVALID_REDIRECT_URI, message: `无效的回调地址: ${uri}` },
              { status: 400 }
            );
          }
        }
      }

      // 构建更新数据载荷，杜绝 Record<string, any>
      const updateData: ClientUpdatePayload = { updatedAt: new Date() };
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
    } catch (error) {
      console.error('[Client Detail PUT] Failed to update client:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '系统内部错误' },
        { status: 500 }
      );
    }
  });
}

/**
 * DELETE /api/clients/[id]
 * 删除（物理或逻辑删除）客户端
 * 权限要求: client:delete
 * 
 * @param request Next.js 请求对象
 * @param params 路由参数 (Promise<{ id: string }>)
 * @returns 操作结果 JSON 响应
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['client:delete'] }, async () => {
    try {
      const { id } = await params;
      const searchParams = request.nextUrl.searchParams;
      const mode = searchParams.get('mode') || 'disable';

      // 检查 Client 是否存在
      const existing = await db.select()
        .from(schema.clients)
        .where(eq(schema.clients.id, id));

      if (existing.length === 0) {
        return NextResponse.json(
          { error: CLIENT_ERRORS.CLIENT_NOT_FOUND, message: 'Client 不存在' },
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
          data: { id, status: 'DISABLED' as EntityStatus },
        });
      }
    } catch (error) {
      console.error('[Client Detail DELETE] Failed to delete or disable client:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '系统内部错误' },
        { status: 500 }
      );
    }
  });
}