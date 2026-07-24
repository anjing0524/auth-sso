/**
 * OAuth Client 详情与操作 API (REST 薄 Controller)
 *
 * GET 读操作委托给 clients/data.ts 统一读模型。
 */
import { type NextRequest } from 'next/server';
import { withPermission, logServerDataRead } from '@/lib/auth';
import { CLIENT_ERRORS, CLIENT_PERMISSIONS } from '@auth-sso/contracts';
import { getClientById } from '@/app/(dashboard)/clients/data';
import { restSuccess, restError } from '@/lib/response';


interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/clients/[id] — 委托 data.ts */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: [CLIENT_PERMISSIONS.READ] }, async () => {
    const { id } = await params;
    const client = await getClientById(id);
    if (!client) {
      return restError(CLIENT_ERRORS.CLIENT_NOT_FOUND, 'Client 不存在', 404);
    }

    // 记录访问日志
    await logServerDataRead('client', id);

    return restSuccess(client);
  });
}
