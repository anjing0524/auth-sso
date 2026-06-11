/**
 * 权限管理 API 路由端点
 *
 * GET /api/permissions - 获取系统全量权限列表
 * POST /api/permissions - 创建系统新权限项
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, asc, and } from 'drizzle-orm';
import { withPermission } from '@/lib/auth-middleware';
import { generateUUID, generatePermissionPublicId } from '@/lib/crypto';
import { COMMON_ERRORS, PERMISSION_ERRORS, EntityStatus } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * GET /api/permissions
 * 获取权限列表
 *
 * @param request NextRequest 对象
 * @returns JSON 响应，包含权限列表数据
 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['permission:list'] }, async () => {
    try {
      const searchParams = request.nextUrl.searchParams;
      const type = searchParams.get('type') || '';

      // 构建动态查询条件数组，确保未来易于扩充且避免 as any 逃避
      const conditions = [];
      if (type) {
        conditions.push(eq(schema.permissions.type, type as 'MENU' | 'API' | 'DATA'));
      }

      const permissions = await db.select()
        .from(schema.permissions)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(asc(schema.permissions.sort), asc(schema.permissions.createdAt));

      return NextResponse.json({
        data: permissions.map(p => ({
          id: p.id,
          publicId: p.publicId,
          name: p.name,
          code: p.code,
          type: p.type,
          resource: p.resource,
          action: p.action,
          parentId: p.parentId,
          status: p.status,
          sort: p.sort,
          createdAt: p.createdAt,
        })),
      });
    } catch (error) {
      // 记录精细的原生系统错误日志用于后台调试，对客户端进行异常脱敏
      console.error('[Permissions GET] Failed to fetch permission list:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '获取权限列表失败' },
        { status: 500 }
      );
    }
  });
}

/**
 * POST /api/permissions
 * 创建系统新权限
 *
 * @param request NextRequest 对象
 * @returns JSON 响应，包含成功状态与新权限信息
 */
export async function POST(request: NextRequest) {
  return withPermission(request, { permissions: ['permission:create'] }, async () => {
    try {
      const body = await request.json();
      const { name, code, type = 'API', resource, action, parentId, sort = 0, status = 'ACTIVE' } = body;

      // 前置校验：必要字段缺一不可
      if (!name || !code) {
        return NextResponse.json(
          { error: COMMON_ERRORS.VALIDATION_ERROR, message: '权限名称和编码不能为空' },
          { status: 400 }
        );
      }

      // 检查编码是否已存在，确保唯一性约束不被静默破坏
      const existing = await db.select()
        .from(schema.permissions)
        .where(eq(schema.permissions.code, code));

      if (existing.length > 0) {
        return NextResponse.json(
          { error: PERMISSION_ERRORS.PERMISSION_ALREADY_EXISTS, message: '权限编码已存在' },
          { status: 400 }
        );
      }

      // 复用全局安全工具库，确保生成规则一致性与高防碰撞强度
      const id = generateUUID();
      const publicId = generatePermissionPublicId();

      await db.insert(schema.permissions).values({
        id,
        publicId,
        name,
        code,
        type: type as 'MENU' | 'API' | 'DATA',
        resource: resource ?? null,
        action: action ?? null,
        parentId: parentId ?? null,
        sort,
        status: status as EntityStatus,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return NextResponse.json({
        success: true,
        data: { id, publicId, name, code, type, resource, action, parentId, sort, status },
      });
    } catch (error) {
      // 记录精细的原生系统错误日志用于后台调试，对客户端进行异常脱敏
      console.error('[Permissions POST] Failed to create permission:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '创建权限失败' },
        { status: 500 }
      );
    }
  });
}