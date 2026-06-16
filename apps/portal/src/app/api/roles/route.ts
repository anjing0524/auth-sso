/**
 * 角色管理 API (REST 薄 Controller)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq, or, ilike, asc, desc, and } from 'drizzle-orm';
import { withPermission } from '@/lib/auth';
import { generateId } from '@/lib/crypto';
import { createRole, roleToInsertRow } from '@/domain/role/role';
import { CreateRoleInputSchema } from '@/domain/role/types';
import { DuplicateEntityError } from '@/domain/shared/errors';
import { mapDomainError } from '@/domain/shared/error-mapping';
import type { EntityStatus } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/** GET /api/roles */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['role:list'] }, async () => {
    const sp = request.nextUrl.searchParams;
    const keyword = sp.get('keyword') || '';
    const status = sp.get('status') || '';
    const page = parseInt(sp.get('page') || '1', 10);
    const pageSize = parseInt(sp.get('pageSize') || '10', 10);
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (keyword) conditions.push(or(ilike(schema.roles.name, `%${keyword}%`), ilike(schema.roles.code, `%${keyword}%`)));
    if (status) conditions.push(eq(schema.roles.status, status as EntityStatus));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const allRows = await db.select({ id: schema.roles.id }).from(schema.roles).where(whereClause);
    const total = allRows.length;

    const rows = await db.select().from(schema.roles).where(whereClause)
      .orderBy(asc(schema.roles.sort), desc(schema.roles.createdAt)).limit(pageSize).offset(offset);

    return NextResponse.json({
      data: rows.map(r => ({ id: r.id, publicId: r.publicId, name: r.name, code: r.code, description: r.description, dataScopeType: r.dataScopeType, isSystem: r.isSystem, status: r.status, sort: r.sort, createdAt: r.createdAt })),
      pagination: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    });
  });
}

/** POST /api/roles — Zod 门禁 → 领域纯函数 → Drizzle 直调 */
export async function POST(request: NextRequest) {
  return withPermission(request, { permissions: ['role:create'] }, async () => {
    const body = await request.json();
    const parsed = CreateRoleInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message }, { status: 400 });
    }

    const existing = await db.query.roles.findFirst({ where: eq(schema.roles.code, parsed.data.code) });
    if (existing) throw new DuplicateEntityError('Role', 'code');

    const role = createRole(parsed.data, generateId);
    await db.insert(schema.roles).values(roleToInsertRow(role));

    return NextResponse.json({ success: true, data: { id: role.publicId, name: role.name } }, { status: 201 });
  });
}
