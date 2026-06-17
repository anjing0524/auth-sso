/**
 * 角色权限绑定 API
 * GET /api/roles/[id]/permissions — 委托 data.ts 获取角色的权限
 * POST /api/roles/[id]/permissions — 为角色分配权限
 * PUT /api/roles/[id]/permissions — 更新角色权限
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/auth';
import { getRolePermissions } from '@/app/roles/data';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/roles/[id]/permissions — 委托 data.ts */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['role:read'] }, async () => {
    const { id } = await params;
    const permissions = await getRolePermissions(id);
    return NextResponse.json({ data: permissions });
  });
}