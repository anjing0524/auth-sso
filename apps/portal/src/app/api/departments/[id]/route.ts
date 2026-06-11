/**
 * 部门详情与操作 API 路由处理器
 * @module apps/portal/api/departments/[id]
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, or } from 'drizzle-orm';
import { withPermission, checkDataScope } from '@/lib/auth-middleware';
import { COMMON_ERRORS, DEPARTMENT_ERRORS, EntityStatus } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * 路由参数定义
 */
interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * 部门更新数据接口定义
 */
interface DepartmentUpdatePayload {
  name?: string;
  code?: string | null;
  parentId?: string | null;
  sort?: number;
  status?: EntityStatus;
  updatedAt: Date;
}

/**
 * GET /api/departments/[id]
 * 获取特定部门的详细信息
 * 权限要求: department:read
 * 
 * @param request Next.js 请求对象
 * @param params 路由参数 (Promise<{ id: string }>)
 * @returns 部门详情 JSON 响应
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['department:read'] }, async (userId) => {
    const { id } = await params;

    const result = await db.select()
      .from(schema.departments)
      .where(or(eq(schema.departments.id, id), eq(schema.departments.publicId, id)));

    if (result.length === 0) {
      return NextResponse.json(
        { error: DEPARTMENT_ERRORS.DEPARTMENT_NOT_FOUND, message: '部门不存在' }, 
        { status: 404 }
      );
    }

    const d = result[0]!;

    // 数据范围检查
    const hasScope = await checkDataScope(userId, d.id);
    if (!hasScope) {
      return NextResponse.json(
        { error: COMMON_ERRORS.FORBIDDEN, message: '无权访问该部门' },
        { status: 403 }
      );
    }

    return NextResponse.json({
      data: {
        id: d.id,
        publicId: d.publicId,
        parentId: d.parentId,
        name: d.name,
        code: d.code,
        sort: d.sort,
        status: d.status,
        createdAt: d.createdAt,
      },
    });
  });
}

/**
 * PUT /api/departments/[id]
 * 更新特定部门信息
 * 权限要求: department:update
 * 
 * @param request Next.js 请求对象
 * @param params 路由参数 (Promise<{ id: string }>)
 * @returns 操作结果 JSON 响应
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['department:update'] }, async (userId) => {
    const { id } = await params;
    const body = await request.json();
    const { name, code, parentId, sort, status } = body;

    // 检查部门是否存在
    const existing = await db.select()
      .from(schema.departments)
      .where(or(eq(schema.departments.id, id), eq(schema.departments.publicId, id)));

    if (existing.length === 0) {
      return NextResponse.json(
        { error: DEPARTMENT_ERRORS.DEPARTMENT_NOT_FOUND, message: '部门不存在' }, 
        { status: 404 }
      );
    }

    const d = existing[0]!;

    // 防循环引用检查：利用溯源算法追溯新父部门的所有祖先，彻底拦截可能形成的树形环路引用死锁
    if (parentId && parentId !== d.parentId) {
      let currentParentId: string | null = parentId;
      while (currentParentId) {
        if (currentParentId === d.id || currentParentId === d.publicId) {
          return NextResponse.json(
            { error: DEPARTMENT_ERRORS.CANNOT_MOVE_TO_CHILD, message: '不能将父部门设为自身或子部门，这会导致环形死锁' },
            { status: 400 }
          );
        }

        // 向上检索当前父部门的父级节点
        const parentDept = await db.select({
          parentId: schema.departments.parentId,
        })
        .from(schema.departments)
        .where(or(eq(schema.departments.id, currentParentId), eq(schema.departments.publicId, currentParentId)))
        .limit(1);

        if (parentDept.length === 0) {
          break;
        }
        currentParentId = parentDept[0].parentId;
      }
    }

    // 数据范围检查：修改部门前，目标部门必须在当前用户管辖范围内
    const hasScope = await checkDataScope(userId, d.id);
    if (!hasScope) {
      return NextResponse.json(
        { error: COMMON_ERRORS.FORBIDDEN, message: '无权修改该部门' },
        { status: 403 }
      );
    }

    // 如果尝试修改父部门，检查新父部门是否在范围内
    if (parentId !== undefined && parentId !== d.parentId && parentId !== null) {
      const hasNewParentScope = await checkDataScope(userId, parentId);
      if (!hasNewParentScope) {
        return NextResponse.json(
          { error: COMMON_ERRORS.FORBIDDEN, message: '无权将部门移至该父部门下' },
          { status: 403 }
        );
      }
    }

    // 严格类型数据拼装，替换 Record<string, any>
    const updateData: DepartmentUpdatePayload = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name;
    if (code !== undefined) updateData.code = code ?? null;
    if (parentId !== undefined) updateData.parentId = parentId || null;
    if (sort !== undefined) updateData.sort = sort;
    if (status !== undefined) updateData.status = status as EntityStatus;

    await db.update(schema.departments).set(updateData).where(eq(schema.departments.id, d.id));

    return NextResponse.json({ success: true });
  });
}

/**
 * DELETE /api/departments/[id]
 * 删除特定部门
 * 权限要求: department:delete
 * 
 * @param request Next.js 请求对象
 * @param params 路由参数 (Promise<{ id: string }>)
 * @returns 操作结果 JSON 响应
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['department:delete'] }, async (userId) => {
    const { id } = await params;

    // 检查部门是否存在
    const existing = await db.select()
      .from(schema.departments)
      .where(or(eq(schema.departments.id, id), eq(schema.departments.publicId, id)));

    if (existing.length === 0) {
      return NextResponse.json(
        { error: DEPARTMENT_ERRORS.DEPARTMENT_NOT_FOUND, message: '部门不存在' }, 
        { status: 404 }
      );
    }

    const d = existing[0]!;

    // 数据范围检查
    const hasScope = await checkDataScope(userId, d.id);
    if (!hasScope) {
      return NextResponse.json(
        { error: COMMON_ERRORS.FORBIDDEN, message: '无权删除该部门' },
        { status: 403 }
      );
    }

    // 检查是否有子部门
    const children = await db.select()
      .from(schema.departments)
      .where(eq(schema.departments.parentId, d.id))
      .limit(1);

    if (children.length > 0) {
      return NextResponse.json(
        { error: DEPARTMENT_ERRORS.DEPARTMENT_HAS_CHILDREN, message: '该部门下有子部门，无法删除' }, 
        { status: 400 }
      );
    }

    await db.delete(schema.departments).where(eq(schema.departments.id, d.id));

    return NextResponse.json({ success: true, message: '部门已删除' });
  });
}