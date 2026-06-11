/**
 * 角色详情与操作 API 路由处理器
 * @module apps/portal/api/roles/[id]
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { withPermission } from '@/lib/auth-middleware';
import { clearUsersPermissionCache } from '@/lib/permissions';
import { COMMON_ERRORS, ROLE_ERRORS, EntityStatus, DataScopeType } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * 路由参数定义
 */
interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * 角色更新载荷接口定义
 */
interface RoleUpdatePayload {
  name?: string;
  description?: string | null;
  dataScopeType?: DataScopeType;
  sort?: number;
  status?: EntityStatus;
  updatedAt: Date;
}

/**
 * GET /api/roles/[id]
 * 获取特定角色的详细信息
 * 权限要求: role:read
 * 
 * @param request Next.js 请求对象
 * @param params 路由参数 (Promise<{ id: string }>)
 * @returns 角色详情 JSON 响应
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['role:read'] }, async () => {
    const { id } = await params;

    const result = await db.select()
      .from(schema.roles)
      .where(eq(schema.roles.id, id));

    if (result.length === 0) {
      return NextResponse.json(
        { error: ROLE_ERRORS.ROLE_NOT_FOUND, message: '角色不存在' }, 
        { status: 404 }
      );
    }

    const r = result[0]!;
    return NextResponse.json({
      data: {
        id: r.id,
        publicId: r.publicId,
        name: r.name,
        code: r.code,
        description: r.description,
        dataScopeType: r.dataScopeType,
        isSystem: r.isSystem,
        status: r.status,
        sort: r.sort,
        createdAt: r.createdAt,
      },
    });
  });
}

/**
 * PUT /api/roles/[id]
 * 更新指定角色的基本信息
 * 权限要求: role:update
 * 
 * @param request Next.js 请求对象
 * @param params 路由参数 (Promise<{ id: string }>)
 * @returns 操作结果 JSON 响应
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['role:update'] }, async () => {
    const { id } = await params;
    const body = await request.json();
    const { name, description, dataScopeType, sort, status } = body;

    try {
      // 获取现有角色
      const existing = await db.select().from(schema.roles).where(eq(schema.roles.id, id));
      if (existing.length === 0) {
        return NextResponse.json(
          { error: ROLE_ERRORS.ROLE_NOT_FOUND, message: '角色不存在' }, 
          { status: 404 }
        );
      }

      // 系统保留角色修改限制
      if (existing[0]!.isSystem) {
        return NextResponse.json(
          { error: ROLE_ERRORS.CANNOT_MODIFY_SYSTEM_ROLE, message: '系统内置角色禁止修改' },
          { status: 400 }
        );
      }

      // 强类型安全装配载荷
      const updateData: RoleUpdatePayload = { updatedAt: new Date() };
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description ?? null;
      if (dataScopeType !== undefined) updateData.dataScopeType = dataScopeType as DataScopeType;
      if (sort !== undefined) updateData.sort = sort;
      if (status !== undefined) updateData.status = status as EntityStatus;

      await db.update(schema.roles).set(updateData).where(eq(schema.roles.id, id));

      // 联动清除所有分配了该角色的用户的权限缓存，保障强一致性
      const boundUsers = await db.select({ userId: schema.userRoles.userId })
        .from(schema.userRoles)
        .where(eq(schema.userRoles.roleId, id));

      if (boundUsers.length > 0) {
        const userIds = boundUsers.map(u => u.userId);
        await clearUsersPermissionCache(userIds);
      }

      return NextResponse.json({ success: true });
    } catch (error: any) {
      console.error('[RoleUpdate] Error:', error.message);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: `修改角色失败: ${error.message}` },
        { status: 500 }
      );
    }
  });
}

/**
 * DELETE /api/roles/[id]
 * 彻底物理删除角色项及其关联关系 (联动清缓存)
 * 权限要求: role:delete
 * 
 * @param request Next.js 请求对象
 * @param params 路由参数 (Promise<{ id: string }>)
 * @returns 操作结果 JSON 响应
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['role:delete'] }, async () => {
    const { id } = await params;

    try {
      // 检查是否为系统保留角色
      const role = await db.select().from(schema.roles).where(eq(schema.roles.id, id));
      if (role.length === 0) {
        return NextResponse.json(
          { error: ROLE_ERRORS.ROLE_NOT_FOUND, message: '角色不存在' }, 
          { status: 404 }
        );
      }

      if (role[0]!.isSystem) {
        return NextResponse.json(
          { error: ROLE_ERRORS.CANNOT_DELETE_SYSTEM_ROLE, message: '系统内置角色无法删除' }, 
          { status: 400 }
        );
      }

      // 1. 在物理删除关联关系之前，查询所有绑定了该角色的用户列表
      const boundUsers = await db.select({ userId: schema.userRoles.userId })
        .from(schema.userRoles)
        .where(eq(schema.userRoles.roleId, id));

      // 2. 清除角色关联与角色本身 (事务原子级删除)
      await db.transaction(async (tx) => {
        await tx.delete(schema.userRoles).where(eq(schema.userRoles.roleId, id));
        await tx.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, id));
        await tx.delete(schema.roles).where(eq(schema.roles.id, id));
      });

      // 3. 联动批量清除相关用户的权限缓存，保障强一致性
      if (boundUsers.length > 0) {
        const userIds = boundUsers.map(u => u.userId);
        await clearUsersPermissionCache(userIds);
      }

      return NextResponse.json({ success: true, message: '角色已删除' });
    } catch (error: any) {
      console.error('[RoleDelete] Error:', error.message);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: `删除角色失败: ${error.message}` },
        { status: 500 }
      );
    }
  });
}