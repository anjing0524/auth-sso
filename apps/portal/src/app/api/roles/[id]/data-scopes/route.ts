import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { withPermission } from '@/lib/auth-middleware';
import { randomBytes } from 'crypto';

export const runtime = 'nodejs';

/**
 * 生成随机 ID
 */
function generateId(length: number = 20): string {
  return randomBytes(length).toString('hex').slice(0, length);
}

/**
 * GET /api/roles/[id]/data-scopes
 * 获取指定角色的自定义数据范围（部门列表）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: roleId } = await params;

  return withPermission(request, { permissions: ['role:read'] }, async () => {
    // 检查角色是否存在
    const roleResult = await sql`
      SELECT id FROM roles WHERE id = ${roleId}
    `;

    if (roleResult.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: '角色不存在' },
        { status: 404 }
      );
    }

    // 查询关联的部门
    const dataScopes = await sql`
      SELECT 
        rds.dept_id,
        d.name as dept_name,
        d.public_id as dept_public_id
      FROM role_data_scopes rds
      JOIN departments d ON rds.dept_id = d.id
      WHERE rds.role_id = ${roleId}
    `;

    return NextResponse.json({
      data: dataScopes.map(ds => ({
        deptId: ds.dept_id,
        deptName: ds.dept_name,
        deptPublicId: ds.dept_public_id,
      })),
    });
  });
}

/**
 * POST /api/roles/[id]/data-scopes
 * 批量更新角色的自定义数据范围
 * 采用先删后增策略
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
          { error: 'invalid_params', message: 'deptIds 必须是数组' },
          { status: 400 }
        );
      }

      // 检查角色是否存在
      const roleResult = await sql`
        SELECT id FROM roles WHERE id = ${roleId}
      `;

      if (roleResult.length === 0) {
        return NextResponse.json(
          { error: 'not_found', message: '角色不存在' },
          { status: 404 }
        );
      }

      // 开启事务处理
      await sql.begin(async (tx: any) => {
        // 1. 删除旧的关联
        await tx`
          DELETE FROM role_data_scopes WHERE role_id = ${roleId}
        `;

        // 2. 插入新的关联
        if (deptIds.length > 0) {
          const values = deptIds.map(deptId => ({
            id: generateId(20),
            role_id: roleId,
            dept_id: deptId,
            created_at: new Date(),
          }));

          await tx`
            INSERT INTO role_data_scopes ${tx(values, 'id', 'role_id', 'dept_id', 'created_at')}
          `;
        }
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('[RoleDataScope] Update error:', error);
      return NextResponse.json(
        { error: 'internal_error', message: '更新失败' },
        { status: 500 }
      );
    }
  });
}

/**
 * DELETE /api/roles/[id]/data-scopes
 * 移除特定的部门关联（可选，通常 POST 批量更新已足够）
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
      { error: 'invalid_params', message: '缺少 deptId 参数' },
      { status: 400 }
    );
  }

  return withPermission(request, { permissions: ['role:update'] }, async () => {
    await sql`
      DELETE FROM role_data_scopes 
      WHERE role_id = ${roleId} AND dept_id = ${deptId}
    `;

    return NextResponse.json({ success: true });
  });
}
