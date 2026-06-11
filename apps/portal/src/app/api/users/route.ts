/**
 * 用户管理 API 路由处理器
 * @module apps/portal/api/users
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, ne, or, ilike, inArray, desc, and, sql as drizzleSql } from 'drizzle-orm';
import { withPermission, getDataScopeFilter, checkDataScope } from '@/lib/auth-middleware';
import { logAuditEvent, getClientIP } from '@/lib/audit';
import { generateId } from '@/lib/crypto';
import { COMMON_ERRORS, USER_ERRORS, UserStatus } from '@auth-sso/contracts';
import bcrypt from 'bcryptjs';

export const runtime = 'nodejs';

/**
 * GET /api/users
 * 获取过滤与分页后的用户列表
 * 权限要求: user:list
 * 
 * @param request Next.js 请求对象
 * @returns 分页用户列表 JSON 响应
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

    // 获取当前管理员的数据范围过滤器
    const scopeFilter = await getDataScopeFilter(userId);

    // 构建基础选择字段列表查询
    const query = db.select({
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

    // 构建过滤条件，默认排除逻辑删除的用户
    const conditions = [ne(schema.users.status, 'DELETED')];

    if (keyword) {
      const searchFilter = or(
        ilike(schema.users.name, `%${keyword}%`),
        ilike(schema.users.email, `%${keyword}%`),
        ilike(schema.users.username, `%${keyword}%`)
      );
      if (searchFilter) conditions.push(searchFilter);
    }

    if (status) {
      conditions.push(eq(schema.users.status, status as UserStatus));
    }

    // 执行基于数据范围的权限过滤
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
          return NextResponse.json({ data: [], pagination: { page, pageSize, total: 0, totalPages: 0 } });
        }
      } else {
        conditions.push(inArray(schema.users.deptId, allowedDeptIds));
      }
    } else if (scopeFilter.type === 'SELF') {
      conditions.push(eq(schema.users.id, userId));
    } else if (deptId) {
      conditions.push(eq(schema.users.deptId, deptId));
    }

    // 执行数据列表查询
    const users = await query
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.users.createdAt))
      .limit(pageSize)
      .offset(offset);

    // 查询满足过滤条件的总条数
    const countResult = await db.select({ count: drizzleSql`COUNT(*)::int` })
      .from(schema.users)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    const total = Number(countResult[0]?.count ?? 0);

    return NextResponse.json({
      data: users.map(u => ({
        id: u.id,
        publicId: u.publicId,
        username: u.username,
        email: u.email,
        name: u.name || u.username || 'Unknown',
        avatarUrl: u.avatarUrl,
        status: u.status,
        deptId: u.deptId,
        deptName: u.deptName || '未分配',
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
 * 创建新用户项 (包含主账户初始化)
 * 权限要求: user:create
 * 
 * @param request Next.js 请求对象
 * @returns 创建成功的用户信息 JSON 响应
 */
export async function POST(request: NextRequest) {
  return withPermission(request, { permissions: ['user:create'] }, async (adminUserId) => {
    const body = await request.json();
    const { username, email, name, password, deptId, status = 'ACTIVE' } = body;

    // 参数校验
    if (!username || !email || !name || !password) {
      return NextResponse.json(
        { error: COMMON_ERRORS.VALIDATION_ERROR, message: '缺少必填字段' }, 
        { status: 400 }
      );
    }

    // 数据范围检查：检查是否有在该部门创建用户的权限
    if (deptId) {
      const hasScope = await checkDataScope(adminUserId, deptId);
      if (!hasScope) {
        return NextResponse.json(
          { error: COMMON_ERRORS.FORBIDDEN, message: '无权在该部门创建用户' }, 
          { status: 403 }
        );
      }
    }

    // 检查用户名或邮箱是否冲突
    const existingUser = await db.select()
      .from(schema.users)
      .where(or(eq(schema.users.username, username), eq(schema.users.email, email)));

    if (existingUser.length > 0) {
      return NextResponse.json(
        { error: USER_ERRORS.USER_ALREADY_EXISTS, message: '用户名或邮箱已存在' }, 
        { status: 400 }
      );
    }

    // 调用全局统一的加密/ID生成工具
    const id = generateId(20);
    const publicId = `user_${generateId(8)}`;

    try {
      await db.transaction(async (tx) => {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // 插入基础用户表
        await tx.insert(schema.users).values({
          id,
          publicId,
          username,
          email,
          name,
          passwordHash: hashedPassword,
          status: status as UserStatus,
          deptId: deptId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // 初始化对应的凭证账号
        await tx.insert(schema.accounts).values({
          id: generateId(20),
          userId: id,
          accountId: email,
          providerId: 'credential',
          password: hashedPassword,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });

      // 记录系统审计日志
      await logAuditEvent({
        userId: adminUserId,
        operation: 'USER_CREATE',
        url: request.url,
        method: request.method,
        params: JSON.stringify({ username, email, name, deptId }),
        ip: getClientIP(request),
        userAgent: request.headers.get('user-agent') || undefined,
        status: 200,
      });

      return NextResponse.json({ 
        success: true, 
        data: { id, publicId, username, email, name, status, deptId } 
      });
    } catch (error: any) {
      console.error('[UserCreate] Transaction Error:', error.message);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: `创建用户失败: ${error.message}` }, 
        { status: 500 }
      );
    }
  });
}

