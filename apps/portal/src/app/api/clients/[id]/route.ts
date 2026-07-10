/**
 * OAuth Client 详情与操作 API (REST 薄 Controller)
 *
 * GET 读操作委托给 clients/data.ts 统一读模型。
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission, logServerDataRead } from '@/lib/auth';
import { CLIENT_ERRORS } from '@auth-sso/contracts';
import { getClientById } from '@/app/(dashboard)/clients/data';


interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/clients/[id] — 委托 data.ts */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: ['client:read'] }, async () => {
    const { id } = await params;
    const client = await getClientById(id);
    if (!client) {
      return NextResponse.json({ error: CLIENT_ERRORS.CLIENT_NOT_FOUND, message: 'Client 不存在' }, { status: 404 });
    }

    // 记录访问日志
    await logServerDataRead('client', id);

    return NextResponse.json({ success: true, data: client });
  });
}
