/**
 * 角色详情与操作 API (REST 薄 Controller)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { withPermission } from '@/lib/auth';
import { clearUsersPermissionCache } from '@/lib/permissions';
import { applyRoleUpdate, roleToUpdateRow, toDomainRole, guardNotSystemRole } from '@/domain/role/role';
import { UpdateRoleInputSchema } from '@/domain/role/types';
import { EntityNotFoundError } from '@/domain/shared/errors';
import { mapDomainError } from '@/domain/shared/error-mapping';

export const runtime = 'nodejs';
interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/roles/[id] */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['role:read'] }, async () => {
    const { id } = await params;
    const row = await db.query.roles.findFirst({ where: eq(schema.roles.id, id) });
    if (!row) return NextResponse.json({ error: 'ROLE_NOT_FOUND', message: '角色不存在' }, { status: 404 });
    const role = toDomainRole(row);
    return NextResponse.json({ data: { ...role, createdAt: role.createdAt.toString() } });
  });
}

/** PUT /api/roles/[id] */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['role:update'] }, async () => {
    const { id } = await params;
    const body = await request.json();
    const parsed = UpdateRoleInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message }, { status: 400 });
    }

    const row = await db.query.roles.findFirst({ where: eq(schema.roles.id, id) });
    if (!row) throw new EntityNotFoundError('Role', id);

    const role = toDomainRole(row);
    guardNotSystemRole(role);

    const updated = applyRoleUpdate(role, parsed.data);
    await db.update(schema.roles).set(roleToUpdateRow(updated))
      .where(eq(schema.roles.id, id));

    const boundUsers = await db.select({ userId: schema.userRoles.userId })
      .from(schema.userRoles).where(eq(schema.userRoles.roleId, id));
    if (boundUsers.length > 0) await clearUsersPermissionCache(boundUsers.map(u => u.userId));

    return NextResponse.json({ success: true });
  });
}

/** DELETE /api/roles/[id] */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['role:delete'] }, async () => {
    const { id } = await params;
    const row = await db.query.roles.findFirst({ where: eq(schema.roles.id, id) });
    if (!row) throw new EntityNotFoundError('Role', id);

    const role = toDomainRole(row);
    guardNotSystemRole(role);

    const boundUsers = await db.select({ userId: schema.userRoles.userId })
      .from(schema.userRoles).where(eq(schema.userRoles.roleId, id));

    await db.transaction(async (tx) => {
      await tx.delete(schema.userRoles).where(eq(schema.userRoles.roleId, id));
      await tx.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, id));
      await tx.delete(schema.roles).where(eq(schema.roles.id, id));
    });

    if (boundUsers.length > 0) await clearUsersPermissionCache(boundUsers.map(u => u.userId));
    return NextResponse.json({ success: true, message: '角色已删除' });
  });
}
