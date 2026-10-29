/**
 * 角色权限绑定 API
 * GET /api/roles/[id]/permissions — 委托 data.ts 获取角色的权限
 * POST /api/roles/[id]/permissions — 为角色分配权限（覆盖式）
 * PUT /api/roles/[id]/permissions — 更新角色权限（与 POST 同一写路径）
 */
import { type NextRequest } from 'next/server';
import { withPermission, logServerDataRead } from '@/lib/auth';
import { resolveScope } from '@/lib/authz';
import { getRoleById, getRolePermissions } from '@/app/(dashboard)/roles/data';
import { COMMON_ERRORS, ROLE_PERMISSIONS  } from '@auth-sso/contracts';
import { db } from '@/infrastructure/db';
import { restSuccess, restError } from '@/lib/response';
import { assignRolePermissions, RolePermissionAssignmentSchema } from '@/lib/role-permission-assignment';
import { invalidateResourceFromRoute } from '@/lib/cache-invalidation';

interface RouteParams { params: Promise<{ id: string }>; }

/**
 * GET /api/roles/[id]/permissions — 委托 data.ts
 *
 * 数据范围由读模型内部施加（scopeFilter）；范围外角色与不存在角色同形返回 404
 * （此前本路由自行查角色再判 403，属重复守卫，见 ADR-014）。
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: [ROLE_PERMISSIONS.READ] }, async (userId) => {
    const { id } = await params;
    const scope = await resolveScope(db, userId);

    const role = await getRoleById(id, scope);
    if (!role) {
      return restError(COMMON_ERRORS.NOT_FOUND, '角色不存在', 404);
    }

    const permissions = await getRolePermissions(id, scope);
    await logServerDataRead('role_permissions', id);
    return restSuccess(permissions);
  });
}

/**
 * POST / PUT — 覆盖式设置角色权限。
 *
 * 写编排（范围守卫 / 系统角色守卫 / 权限有效性 / 事务内删旧插新 / 详细审计 / 权限收敛）
 * 在 `lib/role-permission-assignment.ts`，与 Server Action 共用同一份实现。
 */
async function setPermissions(request: NextRequest, roleId: string, userId: string, method: 'POST' | 'PUT') {
  const body = await request.json().catch(() => null);
  const parsed = RolePermissionAssignmentSchema.safeParse(body);
  if (!parsed.success) {
    return restError(COMMON_ERRORS.VALIDATION_ERROR, '权限参数不合法', 400);
  }

  const result = await assignRolePermissions(userId, roleId, parsed.data.permissionIds, {
    method,
    url: `/api/roles/${roleId}/permissions`,
    ip: request.headers.get('x-forwarded-for'),
    userAgent: request.headers.get('user-agent'),
  });
  if (!result.ok) {
    return restError(result.error, result.message, result.status);
  }

  invalidateResourceFromRoute('roles');
  return restSuccess({ roleId, permissionIds: [...result.permissionIds] });
}

/** POST /api/roles/[id]/permissions — 为角色分配权限（覆盖式） */
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: [ROLE_PERMISSIONS.MANAGE, ROLE_PERMISSIONS.ASSIGN_PERMISSION], requireAll: true }, async (userId) => {
    const { id } = await params;
    return setPermissions(request, id, userId, 'POST');
  });
}

/** PUT /api/roles/[id]/permissions — 更新角色权限（与 POST 同一写路径） */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: [ROLE_PERMISSIONS.MANAGE, ROLE_PERMISSIONS.ASSIGN_PERMISSION], requireAll: true }, async (userId) => {
    const { id } = await params;
    return setPermissions(request, id, userId, 'PUT');
  });
}
