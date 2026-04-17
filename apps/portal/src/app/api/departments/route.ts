/**
 * 部门管理 API
 * GET /api/departments - 获取部门树
 * POST /api/departments - 创建部门
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { asc, inArray } from 'drizzle-orm';
import { withPermission, getDataScopeFilter, checkDataScope } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

/**
 * GET /api/departments
 * 获取部门树
 * 权限要求: department:list
 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['department:list'] }, async (userId) => {
    // 获取数据范围过滤器
    const scopeFilter = await getDataScopeFilter(userId);

    // 查询部门
    let query = db.select().from(schema.departments);
    
    if (scopeFilter.type === 'LIST') {
      const allowedDeptIds = scopeFilter.deptIds || [];
      if (allowedDeptIds.length === 0) {
        return NextResponse.json({ data: [] });
      }
      query = query.where(inArray(schema.departments.id, allowedDeptIds)) as any;
    }

    const departments = await query
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
      // 只有当父部门也在当前返回的列表中时，才作为子节点归入
      if (dept.parentId && deptMap.has(dept.parentId)) {
        deptMap.get(dept.parentId).children.push(node);
      } else {
        // 否则作为根节点（即使它在数据库里有父节点，但在授权范围内它是顶级可见节点）
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
  return withPermission(request, { permissions: ['department:create'] }, async (userId) => {
    const body = await request.json();
    const { name, code, parentId, sort = 0, status = 'ACTIVE' } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'invalid_params', message: '部门名称不能为空' },
        { status: 400 }
      );
    }

    // 数据范围检查：如果指定了父部门，父部门必须在当前用户管辖范围内
    if (parentId) {
      const hasScope = await checkDataScope(userId, parentId);
      if (!hasScope) {
        return NextResponse.json(
          { error: 'forbidden', message: '无权在指定部门下创建子部门' },
          { status: 403 }
        );
      }
    } else {
      // 创建顶级部门通常需要全局权限
      const filter = await getDataScopeFilter(userId);
      if (filter.type !== 'ALL') {
        return NextResponse.json(
          { error: 'forbidden', message: '无权创建顶级部门' },
          { status: 403 }
        );
      }
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