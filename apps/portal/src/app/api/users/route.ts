/**
 * 用户管理 API
 * GET /api/users - 获取用户列表
 * POST /api/users - 创建用户
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, or, ilike, inArray, desc, sql as drizzleSql } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { withPermission, getDataScopeFilter, checkDataScope } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

/**
 * 生成随机 ID
 */
function generateId(length: number = 20): string {
  return randomBytes(length).toString('hex').slice(0, length);
}

/**
 * GET /api/users
 * 获取用户列表
 * 权限要求: user:list
 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['user:list'] }, async (userId) => {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const keyword = searchParams.get('keyword') || '';
    const status = searchParams.get('status') || '';
    const deptId = searchParams.get('deptId') || '';

    const offset = (page - 1) * pageSize;

    // 获取数据范围过滤器
    const scopeFilter = await getDataScopeFilter(userId);

    // 构建基础查询
    let query = db.select({
      id: schema.users.id,
      publicId: schema.users.publicId,
      username: schema.users.username,
      email: schema.users.email,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
      status: schema.users.status,
      deptId: schema.users.deptId,
      deptName: schema.departments.name,
      createdAt: schema.users.createdAt,
      lastLoginAt: schema.users.lastLoginAt,
    })
    .from(schema.users)
    .leftJoin(schema.departments, eq(schema.users.deptId, schema.departments.id));

    // 构建条件
    const conditions = [];

    if (keyword) {
      conditions.push(
        or(
          ilike(schema.users.name, `%${keyword}%`),
          ilike(schema.users.email, `%${keyword}%`),
          ilike(schema.users.username, `%${keyword}%`)
        )
      );
    }

    if (status) {
      conditions.push(eq(schema.users.status, status as 'ACTIVE' | 'DISABLED' | 'LOCKED'));
    }

    // 部门筛选与数据范围过滤的交集处理
    if (scopeFilter.type === 'LIST') {
      const allowedDeptIds = scopeFilter.deptIds || [];
      if (allowedDeptIds.length === 0) {
        return NextResponse.json({
          data: [],
          pagination: { page, pageSize, total: 0, totalPages: 0 },
        });
      }

      if (deptId) {
        if (allowedDeptIds.includes(deptId)) {
          conditions.push(eq(schema.users.deptId, deptId));
        } else {
          return NextResponse.json({
            data: [],
            pagination: { page, pageSize, total: 0, totalPages: 0 },
          });
        }
      } else {
        conditions.push(inArray(schema.users.deptId, allowedDeptIds));
      }
    } else if (deptId) {
      conditions.push(eq(schema.users.deptId, deptId));
    }

    // 执行查询
    const users = await query
      .where(conditions.length > 0 ? drizzleSql`${drizzleSql.join(conditions.map((c, i) => i === 0 ? c : drizzleSql` AND ${c}`))}` : undefined)
      .orderBy(desc(schema.users.createdAt))
      .limit(pageSize)
      .offset(offset);

    // 获取总数
    const countResult = await db.select({ count: drizzleSql`COUNT(*)::int` })
      .from(schema.users)
      .where(conditions.length > 0 ? drizzleSql`${drizzleSql.join(conditions.map((c, i) => i === 0 ? c : drizzleSql` AND ${c}`))}` : undefined);
    const total = Number(countResult[0]?.count ?? 0);

    return NextResponse.json({
      data: users.map(u => ({
        id: u.id,
        publicId: u.publicId,
        username: u.username,
        email: u.email,
        name: u.name,
        avatarUrl: u.avatarUrl,
        status: u.status,
        deptId: u.deptId,
        deptName: u.deptName,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
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
 * POST /api/users
 * 创建用户
 * 权限要求: user:create
 */
export async function POST(request: NextRequest) {
  return withPermission(request, { permissions: ['user:create'] }, async (adminUserId) => {
    const body = await request.json();
    const { username, email, name, password, deptId, status = 'ACTIVE' } = body;

    // 验证必填字段
    if (!username || !email || !name || !password) {
      return NextResponse.json(
        { error: 'invalid_params', message: '缺少必填字段' },
        { status: 400 }
      );
    }

    // 数据范围检查：创建用户时目标部门必须在当前管理员的管辖范围内
    if (deptId) {
      const hasScope = await checkDataScope(adminUserId, deptId);
      if (!hasScope) {
        return NextResponse.json(
          { error: 'forbidden', message: '无权在该部门创建用户' },
          { status: 403 }
        );
      }
    }

    // 检查用户名是否已存在
    const existingUser = await db.select()
      .from(schema.users)
      .where(or(eq(schema.users.username, username), eq(schema.users.email, email)));

    if (existingUser.length > 0) {
      return NextResponse.json(
        { error: 'user_exists', message: '用户名或邮箱已存在' },
        { status: 400 }
      );
    }

    // 生成 ID
    const id = generateId(20);
    const publicId = `user_${generateId(8)}`;

    // 创建用户
    await db.insert(schema.users).values({
      id,
      publicId,
      username,
      email,
      name,
      password,
      status: status as 'ACTIVE' | 'DISABLED' | 'LOCKED',
      deptId: deptId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      data: {
        id,
        publicId,
        username,
        email,
        name,
        status,
        deptId,
      },
    });
  });
}