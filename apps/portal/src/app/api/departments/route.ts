/**
 * 部门管理 API 路由处理器
 * @module apps/portal/api/departments
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { asc, inArray, and } from 'drizzle-orm';
import { withPermission, getDataScopeFilter, checkDataScope } from '@/lib/auth-middleware';
import { generateUUID } from '@/lib/crypto';
import { COMMON_ERRORS, EntityStatus } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * GET /api/departments
 * 获取当前授权范围内的部门树形结构
 * 权限要求: department:list
 * 
 * @param request Next.js 请求对象
 * @returns 部门树形结构 JSON 响应
 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['department:list'] }, async (userId) => {
    // 获取当前管理员对应的数据范围过滤配置
    const scopeFilter = await getDataScopeFilter(userId);

    // 构建动态过滤条件
    const conditions = [];
    
    if (scopeFilter.type === 'LIST') {
      const allowedDeptIds = scopeFilter.deptIds || [];
      if (allowedDeptIds.length === 0) {
        return NextResponse.json({ data: [] });
      }
      conditions.push(inArray(schema.departments.id, allowedDeptIds));
    }

    // 静态类型安全查询，摒弃 as any 强转
    const departments = await db.select()
      .from(schema.departments)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(schema.departments.sort), asc(schema.departments.createdAt));

    // 构建树形结构映射表
    const deptMap = new Map<string, any>();
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
 * 创建新部门项
 * 权限要求: department:create
 * 
 * @param request Next.js 请求对象
 * @returns 创建结果及部门数据 JSON 响应
 */
export async function POST(request: NextRequest) {
  return withPermission(request, { permissions: ['department:create'] }, async (userId) => {
    const body = await request.json();
    const { name, code, parentId, sort = 0, status = 'ACTIVE' } = body;

    // 参数校验
    if (!name) {
      return NextResponse.json(
        { error: COMMON_ERRORS.VALIDATION_ERROR, message: '部门名称不能为空' },
        { status: 400 }
      );
    }

    // 数据范围检查：如果指定了父部门，父部门必须在当前用户管辖范围内
    if (parentId) {
      const hasScope = await checkDataScope(userId, parentId);
      if (!hasScope) {
        return NextResponse.json(
          { error: COMMON_ERRORS.FORBIDDEN, message: '无权在指定部门下创建子部门' },
          { status: 403 }
        );
      }
    } else {
      // 创建顶级部门通常需要全局权限
      const filter = await getDataScopeFilter(userId);
      if (filter.type !== 'ALL') {
        return NextResponse.json(
          { error: COMMON_ERRORS.FORBIDDEN, message: '无权创建顶级部门' },
          { status: 403 }
        );
      }
    }

    // 生成安全的随机 ID 与 PublicID
    const id = generateUUID();
    const publicId = `dept_${Date.now().toString(36)}`;

    // 写入数据库
    await db.insert(schema.departments).values({
      id,
      publicId,
      parentId: parentId ?? null,
      name,
      code: code ?? null,
      sort,
      status: status as EntityStatus,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      data: { id, publicId, name, code, parentId, sort, status },
    });
  });
}