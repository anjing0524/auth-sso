/**
 * 角色管理 API (REST 薄 Controller)
 *
 * GET 读操作委托给 roles/data.ts 统一读模型，消除重复 Drizzle 查询。
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/auth';
import { getRoles } from '@/app/(dashboard)/roles/data';


/** GET /api/roles — 委托 data.ts */
export async function GET(request: NextRequest) {
  return withPermission({ permissions: ['role:list'] }, async (_adminUserId, claims) => {
    const sp = request.nextUrl.searchParams;
    const keyword = sp.get('keyword') || '';
    const status = sp.get('status') || '';
    const page = parseInt(sp.get('page') || '1', 10);
    const pageSize = parseInt(sp.get('pageSize') || '10', 10);

    // 数据范围：仅返回管理员可见部门内的角色（H-ACL-002）
    // deptIds 来自 JWT claims（已含子树展开），无需额外 DB 查询
    const result = await getRoles({ page, pageSize, keyword, status, deptIds: claims.deptIds });
    return NextResponse.json(result);
  });
}
