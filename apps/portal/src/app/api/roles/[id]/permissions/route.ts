/**
 * 角色权限绑定 API
 * GET /api/roles/[id]/permissions - 获取角色的权限
 * POST /api/roles/[id]/permissions - 为角色分配权限
 * PUT /api/roles/[id]/permissions - 更新角色权限
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq, or } from 'drizzle-orm';
import { withPermission } from '@/lib/auth';
import crypto from 'crypto';
import { clearUsersPermissionCache } from '@/lib/permissions';
import { COMMON_ERRORS } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * 路由动态参数接口定义
 */
interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/roles/[id]/permissions
 * 获取角色的权限列表
 * 权限要求: role:read
 *
 * @param request NextRequest 对象
 * @param params 动态路由参数路由 ID (支持 UUID 或 publicId)
 * @returns 角色拥有的权限项列表响应
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  return withPermission(request, { permissions: ['role:read'] }, async () => {
    try {
      const { id } = await params;

      const permissions = await db.select({
        id: schema.permissions.id,
        publicId: schema.permissions.publicId,
        code: schema.permissions.code,
        name: schema.permissions.name,
        type: schema.permissions.type,
        resource: schema.permissions.resource,
        action: schema.permissions.action,
        assignedAt: schema.rolePermissions.createdAt,
      })
      .from(schema.permissions)
      .innerJoin(schema.rolePermissions, eq(schema.permissions.id, schema.rolePermissions.permissionId))
      .innerJoin(schema.roles, eq(schema.rolePermissions.roleId, schema.roles.id))
      .where(or(eq(schema.roles.id, id), eq(schema.roles.publicId, id)));

      return NextResponse.json({
        data: permissions.map(p => ({
          id: p.id,
          publicId: p.publicId,
          code: p.code,
          name: p.name,
          type: p.type,
          resource: p.resource,
          action: p.action,
          assignedAt: p.assignedAt,
        })),
      });
    } catch (error) {
      console.error('[RolePermissions GET] Failed to retrieve permissions for role:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '获取角色权限失败' },
        { status: 500 }
      );
    }
  });
}

/**
 * POST /api/roles/[id]/permissions
 * 为角色分配权限（采用酸性数据库事务保护，防止部分插入失败导致旧数据丢失）
 * 权限要求: role:update
 *
 * @param request NextRequest 对象
 * @param params 动态路由参数路由 ID
 * @returns 关联操作成功状态与分配计数响应
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  return withPermission(request, { permissions: ['role:update'] }, async () => {
    try {
      const { id } = await params;
      const body = await request.json();
      const { permissionIds } = body;

      if (!Array.isArray(permissionIds)) {
        return NextResponse.json(
          { error: COMMON_ERRORS.VALIDATION_ERROR, message: '权限ID列表格式错误' },
          { status: 400 }
        );
      }

      // 验证角色是否存在
      const roles = await db.select()
        .from(schema.roles)
        .where(or(eq(schema.roles.id, id), eq(schema.roles.publicId, id)));

      if (roles.length === 0) {
        return NextResponse.json(
          { error: COMMON_ERRORS.NOT_FOUND, message: '角色不存在' },
          { status: 404 }
        );
      }

      const roleId = roles[0]!.id;

      // 启动 Drizzle 强一致性数据库事务，确保“清除原有绑定”与“批量关联新绑定”具备酸性原子性
      await db.transaction(async (tx) => {
        // 1. 安全地删除现有的权限绑定
        await tx.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));

        // 2. 插入新的权限绑定（如果列表不为空）
        if (permissionIds.length > 0) {
          const rolePermissionsData = permissionIds.map(permissionId => ({
            id: crypto.randomUUID(),
            roleId,
            permissionId,
            createdAt: new Date(),
          }));
          await tx.insert(schema.rolePermissions).values(rolePermissionsData);
        }
      });

      // 3. 联动清除所有分配了该角色的用户的权限缓存，保障缓存强一致性
      const boundUsers = await db.select({ userId: schema.userRoles.userId })
        .from(schema.userRoles)
        .where(eq(schema.userRoles.roleId, roleId));

      if (boundUsers.length > 0) {
        const userIds = boundUsers.map(u => u.userId);
        await clearUsersPermissionCache(userIds);
      }

      return NextResponse.json({ success: true, assignedCount: permissionIds.length });
    } catch (error) {
      console.error('[RolePermissions POST] Failed to allocate permissions to role:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '分配角色权限失败' },
        { status: 500 }
      );
    }
  });
}

/**
 * PUT /api/roles/[id]/permissions
 * 更新角色权限（复用 POST 逻辑）
 * 权限要求: role:update
 *
 * @param request NextRequest 对象
 * @param params 动态路由参数
 * @returns 关联操作成功状态响应
 */
export async function PUT(
  request: NextRequest,
  { params }: RouteParams
) {
  return POST(request, { params });
}