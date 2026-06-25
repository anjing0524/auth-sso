/**
 * 角色详情与操作 API (REST 薄 Controller)
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission, canAccessDept } from '@/lib/auth';
import { COMMON_ERRORS, ROLE_ERRORS } from '@auth-sso/contracts';
import { getRoleById } from '@/app/(dashboard)/roles/data';

interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/roles/[id] — 委托 data.ts */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: ['role:read'] }, async (_adminUserId, claims) => {
    const { id } = await params;
    const role = await getRoleById(id);
    if (!role) return NextResponse.json({ error: ROLE_ERRORS.ROLE_NOT_FOUND, message: '角色不存在' }, { status: 404 });
    // 数据范围：管理员只能查看其可见部门内的角色（H-ACL-002）
    // deptIds 来自 JWT claims，无需额外 DB 查询
    if (!canAccessDept(claims.deptIds, role.deptId)) {
      return NextResponse.json({ error: COMMON_ERRORS.FORBIDDEN, message: '无权查看该角色' }, { status: 403 });
    }
    return NextResponse.json({ data: role });
  });
}
