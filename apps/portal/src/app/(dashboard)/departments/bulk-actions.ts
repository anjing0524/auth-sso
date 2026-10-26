'use server';

/**
 * 部门批量移动 — 独立 Server Action。
 *
 * 产品背景：组织调整常需要把多个部门挂到新父级；逐个点"编辑→改父级"是重复劳动。
 * 这里只做编排：每个 id 复用既有的 updateDepartmentAction（同一套权限/作用域/
 * 循环校验/ancestors 级联/审计），失败逐项计数并反馈，不因个别失败回滚已成功的移动。
 */
import { inArray } from 'drizzle-orm';
import { db, schema } from '@/infrastructure/db';
import { DEPARTMENT_PERMISSIONS } from '@auth-sso/contracts';
import type { ApiResponse } from '@auth-sso/contracts';
import { withAuth } from '@/lib/auth';
import { isUuid } from '@/lib/uuid';
import { COMMON_ERRORS } from '@auth-sso/contracts';
import { updateDepartmentAction } from './actions';

const MAX_BULK = 50;

export const bulkMoveDepartmentsAction = withAuth(
  { permissions: [DEPARTMENT_PERMISSIONS.UPDATE] },
  async (_ctx, ids: string[], parentId: string | null): Promise<ApiResponse<{ moved: number; failed: number; skipped: number }>> => {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BULK) {
      return { success: false, error: COMMON_ERRORS.VALIDATION_ERROR, message: `一次最多移动 ${MAX_BULK} 个部门` };
    }
    const unique = [...new Set(ids)];
    if (unique.some((id) => !isUuid(id))) {
      return { success: false, error: COMMON_ERRORS.VALIDATION_ERROR, message: '部门 ID 非法' };
    }
    if (parentId !== null && !isUuid(parentId)) {
      return { success: false, error: COMMON_ERRORS.VALIDATION_ERROR, message: '目标父部门 ID 非法' };
    }
    if (parentId && unique.includes(parentId)) {
      return { success: false, error: COMMON_ERRORS.VALIDATION_ERROR, message: '不能把部门移动到自身之下' };
    }

    // 只移动“选中的顶层部门”：子部门随父级一起移动，避免把父子同时挪成兄弟。
    // ancestors 是斜杠分隔的 ID 物化路径；祖先也在选中集合时，本项交给父级移动。
    const selected = new Set(unique);
    const rows = await db
      .select({ id: schema.departments.id, ancestors: schema.departments.ancestors })
      .from(schema.departments)
      .where(inArray(schema.departments.id, unique));
    const ancestorPath = new Map(rows.map((r) => [r.id, r.ancestors ?? '']));
    const roots = unique.filter((id) => {
      const path = ancestorPath.get(id) ?? '';
      return !path.split('/').some((ancestor) => selected.has(ancestor));
    });
    const skipped = unique.length - roots.length;

    let moved = 0;
    let failed = 0;
    for (const id of roots) {
      const res = await updateDepartmentAction(id, { parentId });
      if (res.success) moved += 1;
      else failed += 1;
    }
    return {
      success: true,
      data: { moved, failed, skipped },
      message: `已移动 ${moved} 个部门${skipped > 0 ? `（${skipped} 个子部门随父级移动）` : ''}${failed > 0 ? `，${failed} 个失败（循环/越权/父级不可用）` : ''}`,
    };
  },
);
