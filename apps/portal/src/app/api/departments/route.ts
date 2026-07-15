/**
 * 部门管理 API (REST 薄 Controller)
 *
 * GET 读操作委托给 departments/data.ts 统一读模型，消除重复 Drizzle 查询。
 */
import { type NextRequest } from 'next/server';
import { withPermission, getUserRoleDeptIds } from '@/lib/auth';
import { getDepartments } from '@/app/(dashboard)/departments/data';
import { restSuccess } from '@/lib/response';


/** GET /api/departments — 委托 data.ts 获取授权范围内的部门树 */
export async function GET(request: NextRequest) {
  return withPermission({ permissions: ['department:list'] }, async (userId) => {
    const deptIds = await getUserRoleDeptIds(userId);
    const data = await getDepartments(deptIds, userId);
    return restSuccess(data);
  });
}
