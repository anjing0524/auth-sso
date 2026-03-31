/**
 * 权限管理 API
 * GET /api/permissions - 获取权限列表
 * POST /api/permissions - 创建权限
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

/**
 * GET /api/permissions
 * 获取权限列表
 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['permission:list'] }, async (userId) => {
    try {
      const searchParams = request.nextUrl.searchParams;
      const type = searchParams.get('type') || '';

      const whereClause = type ? `WHERE type = '${type}'` : '';

      const permissions = await sql`
        SELECT
          p.id,
          p.public_id,
          p.name,
          p.code,
          p.type,
          p.resource,
          p.action,
          p.parent_id,
          p.status,
          p.sort,
          p.created_at
        FROM permissions p
        ${sql.unsafe(whereClause)}
        ORDER BY p.sort ASC, p.created_at ASC
      `;

      return NextResponse.json({
        data: permissions.map((p: any) => ({
          id: p.id,
          publicId: p.public_id,
          name: p.name,
          code: p.code,
          type: p.type,
          resource: p.resource,
          action: p.action,
          parentId: p.parent_id,
          status: p.status,
          sort: p.sort,
          createdAt: p.created_at,
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
  return withPermission(request, { permissions: ['permission:create'] }, async (userId) => {
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
      const existing = await sql`
        SELECT id FROM permissions WHERE code = ${code}
      `;

      if (existing.length > 0) {
        return NextResponse.json(
          { error: 'permission_exists', message: '权限编码已存在' },
          { status: 400 }
        );
      }

      const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const publicId = `perm_${Date.now().toString(36)}`;

      await sql`
        INSERT INTO permissions (id, public_id, name, code, type, resource, action, parent_id, sort, status, created_at, updated_at)
        VALUES (${id}, ${publicId}, ${name}, ${code}, ${type}, ${resource || null}, ${action || null}, ${parentId || null}, ${sort}, ${status}, NOW(), NOW())
      `;

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