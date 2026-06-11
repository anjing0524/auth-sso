/**
 * 角色数据范围 API
 * GET /api/roles/[id]/data-scopes - 获取角色的自定义数据范围
 * POST /api/roles/[id]/data-scopes - 批量更新角色的自定义数据范围
 * DELETE /api/roles/[id]/data-scopes - 移除特定部门关联
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { withPermission } from '@/lib/auth-middleware';
import { generateUUID } from '@/lib/crypto';
import { COMMON_ERRORS, ROLE_ERRORS } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * GET /api/roles/[id]/data-scopes
 * 获取指定角色的自定义数据范围（关联部门列表）
 * 
 * @param request NextRequest 请求对象
 * @param params 动态路由参数，包含角色 ID
 * @returns 关联部门列表的 JSON 响应
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: roleId } = await params;

  return withPermission(request, { permissions: ['role:read'] }, async () => {
    // 检查角色是否存在
    const roleResult = await db.select()
      .from(schema.roles)
      .where(eq(schema.roles.id, roleId));

    if (roleResult.length === 0) {
      return NextResponse.json(
        { error: ROLE_ERRORS.ROLE_NOT_FOUND, message: '角色不存在' },
        { status: 404 }
      );
    }

    // 查询关联的部门
    const dataScopes = await db.select({
      deptId: schema.roleDataScopes.deptId,
      deptName: schema.departments.name,
      deptPublicId: schema.departments.publicId,
    })
    .from(schema.roleDataScopes)
    .innerJoin(schema.departments, eq(schema.roleDataScopes.deptId, schema.departments.id))
    .where(eq(schema.roleDataScopes.roleId, roleId));

    return NextResponse.json({
      data: dataScopes.map(ds => ({
        deptId: ds.deptId,
        deptName: ds.deptName,
        deptPublicId: ds.deptPublicId,
      })),
    });
  });
}

/**
 * POST /api/roles/[id]/data-scopes
 * 批量更新角色的自定义数据范围 (先删后增的事务强一致性操作)
 * 
 * @param request NextRequest 请求对象，Payload 包含部门 ID 数组
 * @param params 动态路由参数，包含角色 ID
 * @returns 批量更新操作成功与否的 JSON 响应
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: roleId } = await params;

  return withPermission(request, { permissions: ['role:update'] }, async () => {
    try {
      const body = await request.json();
      const { deptIds } = body as { deptIds: string[] };

      if (!Array.isArray(deptIds)) {
        return NextResponse.json(
          { error: COMMON_ERRORS.VALIDATION_ERROR, message: 'deptIds 必须是数组' },
          { status: 400 }
        );
      }

      // 检查角色是否存在
      const roleResult = await db.select()
        .from(schema.roles)
        .where(eq(schema.roles.id, roleId));

      if (roleResult.length === 0) {
        return NextResponse.json(
          { error: ROLE_ERRORS.ROLE_NOT_FOUND, message: '角色不存在' },
          { status: 404 }
        );
      }

      // 使用事务处理，保障批量写入强一致性，防范半损状态
      await db.transaction(async (tx) => {
        // 1. 删除旧的关联
        await tx.delete(schema.roleDataScopes).where(eq(schema.roleDataScopes.roleId, roleId));

        // 2. 插入新的关联
        if (deptIds.length > 0) {
          const values = deptIds.map(deptId => ({
            id: generateUUID(), // 静态导入并使用全局统一的 crypto 工具，保障 DRY
            roleId,
            deptId,
            createdAt: new Date(),
          }));
          await tx.insert(schema.roleDataScopes).values(values);
        }
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('[RoleDataScope] Update error:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '更新失败' },
        { status: 500 }
      );
    }
  });
}

/**
 * DELETE /api/roles/[id]/data-scopes
 * 移除特定的角色-部门自定义范围关联
 * 
 * @param request NextRequest 请求对象，Query 中包含待删除关联的 deptId
 * @param params 动态路由参数，包含角色 ID
 * @returns 移除成功与否的 JSON 响应
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: roleId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const deptId = searchParams.get('deptId');

  if (!deptId) {
    return NextResponse.json(
      { error: COMMON_ERRORS.INVALID_REQUEST, message: '缺少 deptId 参数' },
      { status: 400 }
    );
  }

  return withPermission(request, { permissions: ['role:update'] }, async () => {
    await db.delete(schema.roleDataScopes)
      .where(
        and(
          eq(schema.roleDataScopes.roleId, roleId),
          eq(schema.roleDataScopes.deptId, deptId)
        )
      );

    return NextResponse.json({ success: true });
  });
}