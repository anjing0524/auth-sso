/**
 * 部门管理 API
 * GET /api/departments - 获取部门树
 * POST /api/departments - 创建部门
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

/**
 * GET /api/departments
 * 获取部门树
 * 权限要求: department:list
 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['department:list'] }, async () => {
    // 查询所有部门
    const departments = await sql`
      SELECT
        id,
        public_id,
        parent_id,
        name,
        code,
        sort,
        status,
        created_at
      FROM departments
      ORDER BY sort ASC, created_at ASC
    `;

    // 构建树形结构
    const deptMap = new Map();
    const roots: any[] = [];

    departments.forEach((dept: any) => {
      deptMap.set(dept.id, {
        id: dept.id,
        publicId: dept.public_id,
        parentId: dept.parent_id,
        name: dept.name,
        code: dept.code,
        sort: dept.sort,
        status: dept.status,
        createdAt: dept.created_at,
        children: [],
      });
    });

    departments.forEach((dept: any) => {
      const node = deptMap.get(dept.id);
      if (dept.parent_id && deptMap.has(dept.parent_id)) {
        deptMap.get(dept.parent_id).children.push(node);
      } else {
        roots.push(node);
      }
    });

    return NextResponse.json({ data: roots });
  });
}

/**
 * POST /api/departments
 * 创建部门
 * 权限要求: department:create
 */
export async function POST(request: NextRequest) {
  return withPermission(request, { permissions: ['department:create'] }, async () => {
    const body = await request.json();
    const { name, code, parentId, sort = 0, status = 'ACTIVE' } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'invalid_params', message: '部门名称不能为空' },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const publicId = `dept_${Date.now().toString(36)}`;

    await sql`
      INSERT INTO departments (id, public_id, parent_id, name, code, sort, status, created_at, updated_at)
      VALUES (${id}, ${publicId}, ${parentId || null}, ${name}, ${code || null}, ${sort}, ${status}, NOW(), NOW())
    `;

    return NextResponse.json({
      success: true,
      data: { id, publicId, name, code, parentId, sort, status },
    });
  });
}