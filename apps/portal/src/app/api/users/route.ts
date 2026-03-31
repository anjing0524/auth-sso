/**
 * 用户管理 API
 * GET /api/users - 获取用户列表
 * POST /api/users - 创建用户
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { randomBytes } from 'crypto';
import { withPermission } from '@/lib/auth-middleware';

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
  return withPermission(request, { permissions: ['user:list'] }, async () => {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const keyword = searchParams.get('keyword') || '';
    const status = searchParams.get('status') || '';
    const deptId = searchParams.get('deptId') || '';

    const offset = (page - 1) * pageSize;

    // 构建查询条件
    const conditions: string[] = [];
    if (keyword) {
      conditions.push(`(name ILIKE '%${keyword.replace(/'/g, "''")}%' OR email ILIKE '%${keyword.replace(/'/g, "''")}%' OR username ILIKE '%${keyword.replace(/'/g, "''")}%')`);
    }
    if (status) {
      conditions.push(`status = '${status}'`);
    }
    if (deptId) {
      conditions.push(`dept_id = '${deptId}'`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 查询总数
    const countResult = await sql`
      SELECT COUNT(*) as total FROM users ${sql.unsafe(whereClause)}
    `;
    const total = parseInt(countResult[0]?.total || '0', 10);

    // 查询用户列表
    const users = await sql`
      SELECT
        u.id,
        u.public_id,
        u.username,
        u.email,
        u.name,
        u.avatar_url,
        u.status,
        u.dept_id,
        d.name as dept_name,
        u.created_at,
        u.last_login_at
      FROM users u
      LEFT JOIN departments d ON u.dept_id = d.id
      ${sql.unsafe(whereClause)}
      ORDER BY u.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    return NextResponse.json({
      data: users.map(u => ({
        id: u.id,
        publicId: u.public_id,
        username: u.username,
        email: u.email,
        name: u.name,
        avatarUrl: u.avatar_url,
        status: u.status,
        deptId: u.dept_id,
        deptName: u.dept_name,
        createdAt: u.created_at,
        lastLoginAt: u.last_login_at,
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
  return withPermission(request, { permissions: ['user:create'] }, async () => {
    const body = await request.json();
    const { username, email, name, password, deptId, status = 'ACTIVE' } = body;

    // 验证必填字段
    if (!username || !email || !name || !password) {
      return NextResponse.json(
        { error: 'invalid_params', message: '缺少必填字段' },
        { status: 400 }
      );
    }

    // 检查用户名是否已存在
    const existingUser = await sql`
      SELECT id FROM users WHERE username = ${username} OR email = ${email}
    `;

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
    await sql`
      INSERT INTO users (id, public_id, username, email, name, password, status, dept_id, created_at, updated_at)
      VALUES (${id}, ${publicId}, ${username}, ${email}, ${name}, ${password}, ${status}, ${deptId || null}, NOW(), NOW())
    `;

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