/**
 * 权限详情 API (REST 薄 Controller)
 *
 * GET 读操作委托给 permissions/data.ts 统一读模型。
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/auth';
import { COMMON_ERRORS } from '@auth-sso/contracts';
import { getPermissionById } from '@/app/(dashboard)/permissions/data';

interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/permissions/[id] — 委托 data.ts */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: ['permission:read'] }, async () => {
    const { id } = await params;
    const perm = await getPermissionById(id);
    if (!perm) return NextResponse.json({ error: COMMON_ERRORS.NOT_FOUND, message: '权限不存在' }, { status: 404 });
    return NextResponse.json({ data: perm });
  });
}
