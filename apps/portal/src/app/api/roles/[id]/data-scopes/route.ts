/**
 * 角色数据范围 API (REST 薄 Controller)
 * GET /api/roles/[id]/data-scopes — 委托 data.ts 获取角色的自定义数据范围
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/auth';
import { ROLE_ERRORS } from '@auth-sso/contracts';
import { getRoleById, getRoleDataScopes } from '@/app/roles/data';

export const runtime = 'nodejs';

/** GET /api/roles/[id]/data-scopes — 委托 data.ts */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPermission(request, { permissions: ['role:read'] }, async () => {
    const { id: roleId } = await params;

    const role = await getRoleById(roleId);
    if (!role) return NextResponse.json({ error: ROLE_ERRORS.ROLE_NOT_FOUND, message: '角色不存在' }, { status: 404 });

    const dataScopes = await getRoleDataScopes(role.id);
    return NextResponse.json({ data: dataScopes });
  });
}