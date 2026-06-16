/**
 * 部门详情与操作 API (REST 薄 Controller)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq, or } from 'drizzle-orm';
import { withPermission, checkDataScope } from '@/lib/auth';
import { applyDepartmentUpdate, toDomainDepartment, validateNoCircularReference } from '@/domain/department/department';
import { UpdateDepartmentInputSchema } from '@/domain/department/types';
import { EntityNotFoundError, BusinessRuleViolationError } from '@/domain/shared/errors';
import { mapDomainError } from '@/domain/shared/error-mapping';

export const runtime = 'nodejs';
interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/departments/[id] */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['department:read'] }, async (userId) => {
    const { id } = await params;
    const row = await db.query.departments.findFirst({
      where: or(eq(schema.departments.id, id), eq(schema.departments.publicId, id)),
    });
    if (!row) return NextResponse.json({ error: 'DEPARTMENT_NOT_FOUND', message: '部门不存在' }, { status: 404 });

    const hasScope = await checkDataScope(userId, row.id);
    if (!hasScope) return NextResponse.json({ error: 'FORBIDDEN', message: '无权访问该部门' }, { status: 403 });

    const dept = toDomainDepartment(row);
    return NextResponse.json({ data: { ...dept, createdAt: dept.createdAt.toString() } });
  });
}

/** PUT /api/departments/[id] */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['department:update'] }, async (userId) => {
    const { id } = await params;
    const body = await request.json();
    const parsed = UpdateDepartmentInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message }, { status: 400 });
    }

    await db.transaction(async (tx) => {
      const row = await tx.query.departments.findFirst({
        where: or(eq(schema.departments.id, id), eq(schema.departments.publicId, id)),
      });
      if (!row) throw new EntityNotFoundError('Department', id);

      const dept = toDomainDepartment(row);
      const hasScope = await checkDataScope(userId, dept.id);
      if (!hasScope) throw new BusinessRuleViolationError('无权修改该部门');

      if (parsed.data.parentId !== undefined && parsed.data.parentId !== dept.parentId && parsed.data.parentId) {
        const allDepts = await tx.query.departments.findMany();
        validateNoCircularReference(dept.id, parsed.data.parentId, allDepts);
      }

      const updated = applyDepartmentUpdate(dept, parsed.data);
      await tx.update(schema.departments).set({
        name: updated.name, code: updated.code, parentId: updated.parentId,
        sort: updated.sort, status: updated.status, updatedAt: new Date(),
      }).where(eq(schema.departments.id, dept.id));
    });

    return NextResponse.json({ success: true });
  });
}

/** DELETE /api/departments/[id] */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['department:delete'] }, async (userId) => {
    const { id } = await params;
    const row = await db.query.departments.findFirst({
      where: or(eq(schema.departments.id, id), eq(schema.departments.publicId, id)),
    });
    if (!row) throw new EntityNotFoundError('Department', id);

    const hasScope = await checkDataScope(userId, row.id);
    if (!hasScope) throw new BusinessRuleViolationError('无权删除该部门');

    const children = await db.query.departments.findFirst({ where: eq(schema.departments.parentId, row.id) });
    if (children) throw new BusinessRuleViolationError('该部门下有子部门，无法删除');

    await db.delete(schema.departments).where(eq(schema.departments.id, row.id));
    return NextResponse.json({ success: true, message: '部门已删除' });
  });
}
