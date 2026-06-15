import 'server-only';

/**
 * 数据范围过滤子模块 (Data Scope)
 *
 * 职责：根据用户的角色数据范围（ALL / DEPT / DEPT_AND_SUB / SELF / CUSTOM）
 * 构建数据库查询的过滤条件，并提供单资源的范围所有权校验。
 *
 * 提供三类能力：
 * - `checkDataScope`          — 写/读单资源时的所有权校验（返回 boolean）
 * - `getDataScopeFilter`      — 读路径的范围规则计算（返回 { type, deptIds }）
 * - `applyDataScopeFilter`    — 将范围规则转为 Drizzle SQL 条件（统一消除 ad-hoc 分支）
 *
 * @module lib/auth/data-scope
 */
import { type SQL, inArray, eq, and, sql as drizzleSql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { getUserPermissionContext } from '../permissions';

// ────────────────────────────────────────────────────────────
// 数据范围规则计算
// ────────────────────────────────────────────────────────────

/**
 * 数据范围过滤结果
 *
 * - `undefined` → 无额外过滤条件（对应 ALL 权限）
 * - `null`     → 无权访问任何数据（对应空 LIST）
 * - `SQL`      → 需要追加的 WHERE 条件
 */
type ScopeFilterResult = SQL<unknown> | null | undefined;

/**
 * 将 getDataScopeFilter 返回的数据范围规则转换为 Drizzle SQL 条件
 *
 * 所有读路径统一调用此函数，消除 ad-hoc 的 if/else if 分支（R23 / 防线五）。
 *
 * @param scopeFilter 由 getDataScopeFilter(userId) 返回的数据范围
 * @param deptIdCol   Drizzle 部门 ID 列引用
 * @param userIdCol   Drizzle 用户 ID 列引用
 * @param userId      当前操作者用户 ID
 * @returns SQL 条件 或 null（无权限）或 undefined（全量访问）
 *
 * @example
 * ```ts
 * const scopeSQL = applyDataScopeFilter(scopeFilter, schema.users.deptId, schema.users.id, userId);
 * if (scopeSQL === null) return { data: [], pagination: {...} };  // 无权访问
 * if (scopeSQL !== undefined) conditions.push(scopeSQL);           // 有限范围
 * // undefined → type === 'ALL'，不追加任何条件
 * ```
 */
export function applyDataScopeFilter(
  scopeFilter: { type: 'ALL' | 'LIST' | 'SELF'; deptIds?: string[] },
  deptIdCol: Parameters<typeof eq>[0],
  userIdCol: Parameters<typeof eq>[0],
  userId: string,
): ScopeFilterResult {
  if (scopeFilter.type === 'LIST') {
    const deptIds = scopeFilter.deptIds || [];
    if (deptIds.length === 0) return null;
    return inArray(deptIdCol, deptIds);
  }
  if (scopeFilter.type === 'SELF') {
    return eq(userIdCol, userId);
  }
  // type === 'ALL'：不追加任何过滤条件
  return undefined;
}

/**
 * 获取用户的数据范围过滤器
 * 返回归一化后的范围类型与受控部门 ID 列表，供读路径构建 WHERE 条件
 *
 * @param userId 用户唯一标识 ID
 * @returns 数据权限范围类型及受控部门 ID 数组
 */
export async function getDataScopeFilter(
  userId: string
): Promise<{ type: 'ALL' | 'LIST' | 'SELF'; deptIds?: string[] }> {
  const ctx = await getUserPermissionContext(userId);
  if (!ctx) return { type: 'LIST', deptIds: [] };

  if (ctx.dataScopeType === 'ALL') return { type: 'ALL' };
  if (ctx.dataScopeType === 'SELF') return { type: 'SELF' };
  if (ctx.dataScopeType === 'DEPT') {
    return { type: 'LIST', deptIds: ctx.deptId ? [ctx.deptId] : [] };
  }

  if (ctx.dataScopeType === 'DEPT_AND_SUB') {
    if (!ctx.deptId) return { type: 'LIST', deptIds: [] };

    try {
      const result = await db.execute(drizzleSql`
        WITH RECURSIVE sub_depts AS (
          SELECT id, 1 as depth FROM departments WHERE id = ${ctx.deptId}
          UNION ALL
          SELECT d.id, sd.depth + 1 FROM departments d
          INNER JOIN sub_depts sd ON d.parent_id = sd.id
          WHERE sd.depth < 10
        )
        SELECT id FROM sub_depts
      `);

      const rows = Array.isArray(result)
        ? result
        : ((result as any).rows || (result as any).recordset || []);

      const deptIds = rows
        .map((r: any) => (r && typeof r === 'object' ? (r.id || r.deptId || '') : ''))
        .filter(Boolean);

      return { type: 'LIST', deptIds };
    } catch (error: any) {
      console.error('[DataScope] getDataScopeFilter 查询异常:', error.message);
      return { type: 'LIST', deptIds: [ctx.deptId] };
    }
  }

  if (ctx.dataScopeType === 'CUSTOM') {
    const roleIds = ctx.roles.map((r) => r.id);
    if (roleIds.length === 0) return { type: 'LIST', deptIds: [] };

    const result = await db.selectDistinct({ deptId: schema.roleDataScopes.deptId })
      .from(schema.roleDataScopes)
      .where(inArray(schema.roleDataScopes.roleId, roleIds));

    return { type: 'LIST', deptIds: result.map((r) => r.deptId) };
  }

  return { type: 'LIST', deptIds: [] };
}

/**
 * 检查数据范围权限（单资源所有权校验）
 * 判断用户是否可以访问特定部门的业务数据
 *
 * @param userId        当前操作用户 ID
 * @param targetDeptId  目标部门 ID
 * @param targetUserId  目标资源归属用户 ID（用于 SELF 范围精准过滤）
 * @returns 是否拥有数据访问权限
 */
export async function checkDataScope(
  userId: string,
  targetDeptId: string,
  targetUserId?: string
): Promise<boolean> {
  const ctx = await getUserPermissionContext(userId);
  if (!ctx) return false;

  switch (ctx.dataScopeType) {
    case 'ALL':
      return true;

    case 'SELF':
      // 精准限制：操作用户与目标资源拥有者必须严格相等
      return !!targetUserId && userId === targetUserId;

    case 'DEPT':
      return ctx.deptId === targetDeptId;

    case 'DEPT_AND_SUB': {
      if (!ctx.deptId) return false;
      if (ctx.deptId === targetDeptId) return true;

      try {
        // 递归 CTE 查询子部门（上限 10 层，防死循环）
        const result = await db.execute(drizzleSql`
          WITH RECURSIVE sub_depts AS (
            SELECT id, 1 as depth FROM departments WHERE id = ${ctx.deptId}
            UNION ALL
            SELECT d.id, sd.depth + 1 FROM departments d
            INNER JOIN sub_depts sd ON d.parent_id = sd.id
            WHERE sd.depth < 10
          )
          SELECT 1 FROM sub_depts WHERE id = ${targetDeptId}
        `);

        const rows = Array.isArray(result)
          ? result
          : ((result as any).rows || (result as any).recordset || []);

        return rows.length > 0;
      } catch (error) {
        console.error('[DataScope] DEPT_AND_SUB 查询异常:', error);
        // 降级回退：仅允许访问当前部门（Default-Deny 最小权限原则）
        return ctx.deptId === targetDeptId;
      }
    }

    case 'CUSTOM': {
      const roleIds = ctx.roles.map((r) => r.id);
      if (roleIds.length === 0) return false;

      const result = await db.select()
        .from(schema.roleDataScopes)
        .where(
          and(
            inArray(schema.roleDataScopes.roleId, roleIds),
            eq(schema.roleDataScopes.deptId, targetDeptId)
          )
        );

      return result.length > 0;
    }

    default:
      return false;
  }
}
