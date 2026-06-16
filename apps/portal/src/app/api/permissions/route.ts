/**
 * 权限管理 API (REST 薄 Controller)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq, asc, and } from 'drizzle-orm';
import { withPermission } from '@/lib/auth';
import { generateId } from '@/lib/crypto';
import { createPermission, permissionToInsertRow } from '@/domain/permission/permission';
import { CreatePermissionInputSchema } from '@/domain/permission/types';
import { DuplicateEntityError } from '@/domain/shared/errors';
import { mapDomainError } from '@/domain/shared/error-mapping';
import type { PermissionType } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/** GET /api/permissions */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['permission:list'] }, async () => {
    const type = request.nextUrl.searchParams.get('type') || '';
    const conditions = [];
    if (type) conditions.push(eq(schema.permissions.type, type as PermissionType));

    const rows = await db.select().from(schema.permissions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(schema.permissions.sort), asc(schema.permissions.createdAt));

    return NextResponse.json({
      data: rows.map(p => ({ id: p.id, publicId: p.publicId, name: p.name, code: p.code, type: p.type, resource: p.resource, action: p.action, parentId: p.parentId, status: p.status, sort: p.sort, createdAt: p.createdAt })),
    });
  });
}

/** POST /api/permissions */
export async function POST(request: NextRequest) {
  return withPermission(request, { permissions: ['permission:create'] }, async () => {
    const body = await request.json();
    const parsed = CreatePermissionInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message }, { status: 400 });
    }

    const existing = await db.query.permissions.findFirst({ where: eq(schema.permissions.code, parsed.data.code) });
    if (existing) throw new DuplicateEntityError('Permission', 'code');

    const perm = createPermission(parsed.data, generateId);
    await db.insert(schema.permissions).values(permissionToInsertRow(perm));

    return NextResponse.json({ success: true, data: { id: perm.publicId, name: perm.name } }, { status: 201 });
  });
}
