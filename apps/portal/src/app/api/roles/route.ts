/**
 * 角色管理 API
 * GET /api/roles - 获取角色列表
 * POST /api/roles - 创建角色
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, or, ilike, asc, desc, and } from 'drizzle-orm';
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

    // 构建条件
    const conditions = [];
    if (keyword) {
      conditions.push(
        or(
          ilike(schema.roles.name, `%${keyword}%`),
          ilike(schema.roles.code, `%${keyword}%`)
        )
      );
    }
    if (status) {
      conditions.push(eq(schema.roles.status, status as 'ACTIVE' | 'DISABLED'));
    }

    // 查询角色
    const roles = await db.select()
      .from(schema.roles)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(schema.roles.sort), desc(schema.roles.createdAt));

    return NextResponse.json({
      data: roles.map(r => ({
        id: r.id,
        publicId: r.publicId,
        name: r.name,
        code: r.code,
        description: r.description,
        dataScopeType: r.dataScopeType,
        isSystem: r.isSystem,
        status: r.status,
        sort: r.sort,
        createdAt: r.createdAt,
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
    const existing = await db.select()
      .from(schema.roles)
      .where(eq(schema.roles.code, code));

    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'role_exists', message: '角色编码已存在' },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();
    const publicId = `role_${Date.now().toString(36)}`;

    await db.insert(schema.roles).values({
      id,
      publicId,
      name,
      code,
      description: description ?? null,
      dataScopeType: dataScopeType as 'ALL' | 'DEPT' | 'DEPT_AND_SUB' | 'SELF' | 'CUSTOM',
      sort,
      status: status as 'ACTIVE' | 'DISABLED',
      isSystem: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      data: { id, publicId, name, code, description, dataScopeType, sort, status },
    });
  });
}