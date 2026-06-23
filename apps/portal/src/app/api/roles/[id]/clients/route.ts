/**
 * 角色客户端绑定 API
 * GET /api/roles/[id]/clients — 委托 data.ts 获取角色的可访问客户端
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/auth';
import { getRoleClients } from '@/app/(dashboard)/roles/data';

interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/roles/[id]/clients — 委托 data.ts */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: ['role:read'] }, async () => {
    const { id } = await params;
    const clients = await getRoleClients(id);
    return NextResponse.json({ data: clients });
  });
}
