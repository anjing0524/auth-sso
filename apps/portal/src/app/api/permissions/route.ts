/**
 * 权限管理 API (REST 薄 Controller)
 *
 * GET 读操作委托给 permissions/data.ts 统一读模型，消除重复 Drizzle 查询。
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/auth';
import { getPermissions } from '@/app/(dashboard)/permissions/data';


/** GET /api/permissions — 委托 data.ts，支持按 type 过滤和分页（内存分页，适配 Next.js 缓存） */
export async function GET(request: NextRequest) {
  return withPermission({ permissions: ['permission:list'] }, async () => {
    const sp = request.nextUrl.searchParams;
    const type = sp.get('type') || undefined;
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') || '50', 10)));
    const allData = await getPermissions(type);
    const total = allData.length;
    const totalPages = Math.ceil(total / pageSize);
    const offset = (page - 1) * pageSize;
    const data = allData.slice(offset, offset + pageSize);
    return NextResponse.json({
      success: true,
      data,
      pagination: { page, pageSize, total, totalPages },
    });
  });
}
