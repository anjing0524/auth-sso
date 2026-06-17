/**
 * 角色详情与操作 API (REST 薄 Controller)
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/auth';
import { ROLE_ERRORS } from '@auth-sso/contracts';
import { getRoleById } from '@/app/roles/data';

export const runtime = 'nodejs';
interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/roles/[id] — 委托 data.ts */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['role:read'] }, async () => {
    const { id } = await params;
    const role = await getRoleById(id);
    if (!role) return NextResponse.json({ error: ROLE_ERRORS.ROLE_NOT_FOUND, message: '角色不存在' }, { status: 404 });
    return NextResponse.json({ data: role });
  });
}
