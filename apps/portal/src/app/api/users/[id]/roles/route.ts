/**
 * 用户角色绑定 API
 * GET /api/users/[id]/roles — 委托 data.ts 获取用户的角色
 * POST /api/users/[id]/roles — 为用户分配角色
 * DELETE /api/users/[id]/roles — 移除用户的指定角色
 *
 * 写路径都只是**适配器**：编排（范围守卫 / 事务 / 校验 / 审计 / 权限收敛）
 * 在 `lib/user-role-assignment.ts` 里只写一份，REST 与 Server Action 共用（见该模块头注）。
 */
import { type NextRequest } from 'next/server';
import { db } from '@/infrastructure/db';
import { withPermission, logServerDataRead } from '@/lib/auth';
import { resolveScope } from '@/lib/authz';
import { extractClientIP, extractUserAgent, publicUrlFromRequest } from '@/lib/audit';
import { COMMON_ERRORS, USER_PERMISSIONS } from '@auth-sso/contracts';
import {
  RoleAssignmentSchema,
  RoleRemovalSchema,
  assignUserRoles,
  removeUserRole,
} from '@/lib/user-role-assignment';
import { getUserRoles } from '@/app/(dashboard)/users/data';
import { restSuccess, restError } from '@/lib/response';
import { invalidateResourceFromRoute } from '@/lib/cache-invalidation';

interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/users/[id]/roles — 委托 data.ts（范围由读口施加，不可见与不存在同形 404） */
export async function GET(request: NextRequest, { params }: RouteParams) {
  // 分配角色对话框需要读取"当前已绑定角色"：持有 user:assign_role 即已足够，
  // 不应额外要求 user:read（否则只有分配权限的操作员打开对话框会 403）。
  return withPermission(
    { permissions: [USER_PERMISSIONS.READ, USER_PERMISSIONS.ASSIGN_ROLE] },
    async (adminUserId) => {
    const { id } = await params;
    const scope = await resolveScope(db, adminUserId);
    const roles = await getUserRoles(id, scope);
    if (roles === null) {
      return restError(COMMON_ERRORS.NOT_FOUND, '用户不存在', 404);
    }
      await logServerDataRead('user_roles', id);
      return restSuccess(roles);
    },
  );
}

/**
 * POST /api/users/[id]/roles — 为用户分配角色（v3.2: R-USER-ROLE 部门约束）
 *
 * 缓存失效用 **route 版**入口：`cache-invalidation-site-guard` 禁止 route 用 Action 版
 * （反之亦然），所以它留在适配器里，而写编排在共享模块里。
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: [USER_PERMISSIONS.MANAGE, USER_PERMISSIONS.ASSIGN_ROLE], requireAll: true }, async (adminUserId) => {
    const { id } = await params;
    const parsed = RoleAssignmentSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return restError(COMMON_ERRORS.VALIDATION_ERROR, '角色ID列表格式不合法', 400);

    const result = await assignUserRoles(adminUserId, id, parsed.data.roleIds, {
      method: 'POST',
      url: publicUrlFromRequest(request) ?? request.nextUrl.pathname,
      ip: extractClientIP(request.headers),
      userAgent: extractUserAgent(request.headers),
    });
    if (!result.ok) return restError(result.error, result.message, result.status);

    invalidateResourceFromRoute('users');
    return restSuccess({ assignedCount: result.assignedCount });
  });
}

/**
 * DELETE /api/users/[id]/roles
 * 移除用户的指定角色（🔥已修复：加入 roleId 精准比对，绝不误删该用户的其他所有角色）
 * 权限要求: user:assign_role
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: [USER_PERMISSIONS.MANAGE, USER_PERMISSIONS.ASSIGN_ROLE], requireAll: true }, async (adminUserId) => {
    const { id } = await params;
    const parsed = RoleRemovalSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return restError(COMMON_ERRORS.VALIDATION_ERROR, '角色ID格式不合法', 400);

    const result = await removeUserRole(adminUserId, id, parsed.data.roleId, {
      method: 'DELETE',
      url: publicUrlFromRequest(request) ?? request.nextUrl.pathname,
      ip: extractClientIP(request.headers),
      userAgent: extractUserAgent(request.headers),
    });
    if (!result.ok) return restError(result.error, result.message, result.status);

    invalidateResourceFromRoute('users');
    return restSuccess({});
  });
}
