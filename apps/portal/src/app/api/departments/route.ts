/**
 * 部门管理 API
 * GET /api/departments - 获取部门树
 * POST /api/departments - 创建部门
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { asc } from 'drizzle-orm';
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
    const departments = await db.select()
      .from(schema.departments)
      .orderBy(asc(schema.departments.sort), asc(schema.departments.createdAt));

    // 构建树形结构
    const deptMap = new Map();
    const roots: any[] = [];

    departments.forEach((dept) => {
      deptMap.set(dept.id, {
        id: dept.id,
        publicId: dept.publicId,
        parentId: dept.parentId,
        name: dept.name,
        code: dept.code,
        sort: dept.sort,
        status: dept.status,
        createdAt: dept.createdAt,
        children: [],
      });
    });

    departments.forEach((dept) => {
      const node = deptMap.get(dept.id);
      if (dept.parentId && deptMap.has(dept.parentId)) {
        deptMap.get(dept.parentId).children.push(node);
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

    const id = crypto.randomUUID();
    const publicId = `dept_${Date.now().toString(36)}`;

    await db.insert(schema.departments).values({
      id,
      publicId,
      parentId: parentId ?? null,
      name,
      code: code ?? null,
      sort,
      status: status as 'ACTIVE' | 'DISABLED',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      data: { id, publicId, name, code, parentId, sort, status },
    });
  });
}