/**
 * 角色管理 API
 * GET /api/roles - 获取角色列表
 * POST /api/roles - 创建角色
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

/**
 * GET /api/roles
 * 获取角色列表
 * 权限要求: role:list
 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['role:list'] }, async () => {
    const searchParams = request.nextUrl.searchParams;
    const keyword = searchParams.get('keyword') || '';
    const status = searchParams.get('status') || '';

    const conditions: string[] = [];
    if (keyword) {
      conditions.push(`(name ILIKE '%${keyword.replace(/'/g, "''")}%' OR code ILIKE '%${keyword.replace(/'/g, "''")}%')`);
    }
    if (status) {
      conditions.push(`status = '${status}'`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const roles = await sql`
      SELECT
        r.id,
        r.public_id,
        r.name,
        r.code,
        r.description,
        r.data_scope_type,
        r.is_system,
        r.status,
        r.sort,
        r.created_at
      FROM roles r
      ${sql.unsafe(whereClause)}
      ORDER BY r.sort ASC, r.created_at DESC
    `;

    return NextResponse.json({
      data: roles.map((r: any) => ({
        id: r.id,
        publicId: r.public_id,
        name: r.name,
        code: r.code,
        description: r.description,
        dataScopeType: r.data_scope_type,
        isSystem: r.is_system,
        status: r.status,
        sort: r.sort,
        createdAt: r.created_at,
      })),
    });
  });
}

/**
 * POST /api/roles
 * 创建角色
 * 权限要求: role:create
 */
export async function POST(request: NextRequest) {
  return withPermission(request, { permissions: ['role:create'] }, async () => {
    const body = await request.json();
    const { name, code, description, dataScopeType = 'SELF', sort = 0, status = 'ACTIVE' } = body;

    if (!name || !code) {
      return NextResponse.json(
        { error: 'invalid_params', message: '角色名称和编码不能为空' },
        { status: 400 }
      );
    }

    // 检查编码是否已存在
    const existing = await sql`
      SELECT id FROM roles WHERE code = ${code}
    `;

    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'role_exists', message: '角色编码已存在' },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const publicId = `role_${Date.now().toString(36)}`;

    await sql`
      INSERT INTO roles (id, public_id, name, code, description, data_scope_type, sort, status, created_at, updated_at)
      VALUES (${id}, ${publicId}, ${name}, ${code}, ${description || null}, ${dataScopeType}, ${sort}, ${status}, NOW(), NOW())
    `;

    return NextResponse.json({
      success: true,
      data: { id, publicId, name, code, description, dataScopeType, sort, status },
    });
  });
}