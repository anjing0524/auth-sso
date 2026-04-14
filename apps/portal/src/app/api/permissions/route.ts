/**
 * 权限管理 API
 * GET /api/permissions - 获取权限列表
 * POST /api/permissions - 创建权限
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, asc } from 'drizzle-orm';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

/**
 * GET /api/permissions
 * 获取权限列表
 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['permission:list'] }, async () => {
    try {
      const searchParams = request.nextUrl.searchParams;
      const type = searchParams.get('type') || '';

      // 构建条件
      const conditions = [];
      if (type) {
        conditions.push(eq(schema.permissions.type, type as 'MENU' | 'API' | 'DATA'));
      }

      const permissions = await db.select()
        .from(schema.permissions)
        .where(conditions.length > 0 ? conditions[0] : undefined)
        .orderBy(asc(schema.permissions.sort), asc(schema.permissions.createdAt));

      return NextResponse.json({
        data: permissions.map(p => ({
          id: p.id,
          publicId: p.publicId,
          name: p.name,
          code: p.code,
          type: p.type,
          resource: p.resource,
          action: p.action,
          parentId: p.parentId,
          status: p.status,
          sort: p.sort,
          createdAt: p.createdAt,
        })),
      });
    } catch (error) {
      console.error('[Permissions] GET Error:', error);
      return NextResponse.json(
        { error: 'internal_error', message: '获取权限列表失败' },
        { status: 500 }
      );
    }
  });
}

/**
 * POST /api/permissions
 * 创建权限
 */
export async function POST(request: NextRequest) {
  return withPermission(request, { permissions: ['permission:create'] }, async () => {
    try {
      const body = await request.json();
      const { name, code, type = 'API', resource, action, parentId, sort = 0, status = 'ACTIVE' } = body;

      if (!name || !code) {
        return NextResponse.json(
          { error: 'invalid_params', message: '权限名称和编码不能为空' },
          { status: 400 }
        );
      }

      // 检查编码是否已存在
      const existing = await db.select()
        .from(schema.permissions)
        .where(eq(schema.permissions.code, code));

      if (existing.length > 0) {
        return NextResponse.json(
          { error: 'permission_exists', message: '权限编码已存在' },
          { status: 400 }
        );
      }

      const id = crypto.randomUUID();
      const publicId = `perm_${Date.now().toString(36)}`;

      await db.insert(schema.permissions).values({
        id,
        publicId,
        name,
        code,
        type: type as 'MENU' | 'API' | 'DATA',
        resource: resource ?? null,
        action: action ?? null,
        parentId: parentId ?? null,
        sort,
        status: status as 'ACTIVE' | 'DISABLED',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return NextResponse.json({
        success: true,
        data: { id, publicId, name, code, type, resource, action, parentId, sort, status },
      });
    } catch (error) {
      console.error('[Permissions] POST Error:', error);
      return NextResponse.json(
        { error: 'internal_error', message: '创建权限失败' },
        { status: 500 }
      );
    }
  });
}