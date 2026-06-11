/**
 * 角色管理 API 路由处理器
 * @module apps/portal/api/roles
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, or, ilike, asc, desc, and } from 'drizzle-orm';
import { withPermission } from '@/lib/auth-middleware';
import { generateUUID } from '@/lib/crypto';
import { COMMON_ERRORS, ROLE_ERRORS, EntityStatus, DataScopeType } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * GET /api/roles
 * 获取过滤与分页后的角色列表
 * 权限要求: role:list
 * 
 * @param request Next.js 请求对象
 * @returns 分页角色列表 JSON 响应
 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['role:list'] }, async () => {
    const searchParams = request.nextUrl.searchParams;
    const keyword = searchParams.get('keyword') || '';
    const status = searchParams.get('status') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '10', 10);
    const offset = (page - 1) * pageSize;

    // 构建过滤条件列表
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
      conditions.push(eq(schema.roles.status, status as EntityStatus));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // 统计总数 (防止 Drizzle 对空关联或复杂 count 聚合的解析异常)
    const allRoles = await db.select({ id: schema.roles.id })
      .from(schema.roles)
      .where(whereClause);
    const total = allRoles.length;

    // 分页查询角色
    const roles = await db.select()
      .from(schema.roles)
      .where(whereClause)
      .orderBy(asc(schema.roles.sort), desc(schema.roles.createdAt))
      .limit(pageSize)
      .offset(offset);

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
      pagination: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize)
      }
    });
  });
}

/**
 * POST /api/roles
 * 创建新角色项
 * 权限要求: role:create
 * 
 * @param request Next.js 请求对象
 * @returns 创建成功的角色信息 JSON 响应
 */
export async function POST(request: NextRequest) {
  return withPermission(request, { permissions: ['role:create'] }, async () => {
    const body = await request.json();
    const { name, code, description, dataScopeType = 'SELF', sort = 0, status = 'ACTIVE' } = body;

    // 基础校验
    if (!name || !code) {
      return NextResponse.json(
        { error: COMMON_ERRORS.VALIDATION_ERROR, message: '角色名称和编码不能为空' },
        { status: 400 }
      );
    }

    // 检查编码是否唯一
    const existing = await db.select()
      .from(schema.roles)
      .where(eq(schema.roles.code, code));

    if (existing.length > 0) {
      return NextResponse.json(
        { error: ROLE_ERRORS.ROLE_ALREADY_EXISTS, message: '角色编码已存在' },
        { status: 400 }
      );
    }

    // 调用全局统一的 UUID 生成工具
    const id = generateUUID();
    const publicId = `role_${Date.now().toString(36)}`;

    // 插入数据库
    await db.insert(schema.roles).values({
      id,
      publicId,
      name,
      code,
      description: description ?? null,
      dataScopeType: dataScopeType as DataScopeType,
      sort,
      status: status as EntityStatus,
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