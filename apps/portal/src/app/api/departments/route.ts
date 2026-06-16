/**
 * 部门管理 API (REST 薄 Controller)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { asc } from 'drizzle-orm';
import { withPermission, getDataScopeFilter, applyDataScopeFilter } from '@/lib/auth';
import { generateId } from '@/lib/crypto';
import { createDepartment, departmentToInsertRow, buildDepartmentTree, toDomainDepartment } from '@/domain/department/department';
import { CreateDepartmentInputSchema } from '@/domain/department/types';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { isScopeDenied } from '@/db/user-queries';

export const runtime = 'nodejs';

/** GET /api/departments — 获取部门树 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['department:list'] }, async (userId) => {
    const scopeFilter = await getDataScopeFilter(userId);
    if (isScopeDenied(scopeFilter)) return NextResponse.json({ data: [] });

    const scopeSQL = applyDataScopeFilter(scopeFilter, schema.departments.id, schema.departments.id, userId);
    if (scopeSQL === null) return NextResponse.json({ data: [] });

    const rows = await db.select()
      .from(schema.departments)
      .where(scopeSQL !== undefined ? scopeSQL : undefined)
      .orderBy(asc(schema.departments.sort), asc(schema.departments.createdAt));

    const depts = rows.map(toDomainDepartment);
    return NextResponse.json({ data: scopeFilter.type === 'ALL' ? buildDepartmentTree(depts) : depts });
  });
}

/** POST /api/departments — 创建部门 */
export async function POST(request: NextRequest) {
  return withPermission(request, { permissions: ['department:create'] }, async (userId) => {
    const body = await request.json();
    const parsed = CreateDepartmentInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message }, { status: 400 });
    }

    const dept = createDepartment(parsed.data, generateId);
    await db.insert(schema.departments).values(departmentToInsertRow(dept));

    return NextResponse.json({ success: true, data: { id: dept.publicId, name: dept.name } }, { status: 201 });
  });
}
