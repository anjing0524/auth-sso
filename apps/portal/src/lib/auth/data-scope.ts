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
import { type SQL, inArray, eq, and, or, like } from 'drizzle-orm';
import { db, schema } from '@/infrastructure/db';
import { getUserPermissionContext } from '@/lib/permissions';
import { resolveIdentity } from './verify-jwt';
import type { DataScopeType } from '@auth-sso/contracts';

// ────────────────────────────────────────────────────────────
// 数据范围上下文解析（共享）
// ────────────────────────────────────────────────────────────

/**
 * 解析后的数据范围上下文
 *
 * - `dataScopeType` / `deptId`：决定范围分支
 * - `fetchRoleIds`：仅 CUSTOM 分支需要（查 role_data_scopes 要角色 ID），懒加载
 *   避免在 ALL / DEPT / SELF / DEPT_AND_SUB 分支产生额外 I/O
 *
 * 角色形状归一化说明：
 * - Gateway 内存路径下 `claims.roles` 是角色 **code** 数组（见 signAccessToken）
 * - 持久化 `UserPermissionContext.roles` 是 `{ id, code, name }` 数组
 * - CUSTOM 需要角色 **ID**，统一通过 `UserPermissionContext.roles` 取 id，
 *   消除原先对 `typeof roles[0] === 'string'` 的运行时形状嗅探（假兼容）
 */
interface ResolvedScope {
  dataScopeType: DataScopeType;
  deptId: string;
  fetchRoleIds: () => Promise<string[]>;
}

/**
 * 解析用户的数据范围上下文
 *
 * 优先从 Gateway / 已解析的内存凭据（claims）取 dataScopeType / deptId（零 I/O），
 * 否则回退到持久化权限上下文。角色 ID 始终从权限上下文取，按需懒加载。
 *
 * @param userId 当前操作者用户 ID
 * @returns 数据范围上下文，权限上下文不可用时返回 null
 */
async function resolveScope(userId: string): Promise<ResolvedScope | null> {
  const identity = await resolveIdentity();
  if (identity && identity.userId === userId) {
    return {
      dataScopeType: identity.claims.dataScopeType,
      deptId: identity.claims.deptId,
      // 内存快速路径：roleIds 仅 CUSTOM 分支懒加载
      fetchRoleIds: async () => {
        const ctx = await getUserPermissionContext(userId);
        return ctx ? ctx.roles.map((r) => r.id) : [];
      },
    };
  }

  // 兜底：无内存凭据，一次性从权限上下文取全部字段
  const ctx = await getUserPermissionContext(userId);
  if (!ctx) return null;
  const roleIds = ctx.roles.map((r) => r.id);
  return {
    dataScopeType: ctx.dataScopeType,
    deptId: ctx.deptId ?? '',
    fetchRoleIds: async () => roleIds,
  };
}

/**
 * 通过物化路径 (ancestors) 查询本部门及其全部子部门 ID
 *
 * 替代原先的递归 CTE + extractDeptIdsFromExecute（需要兼容三种 db.execute 返回形态），
 * 直接使用 Drizzle 类型安全查询，无需 any/unknown 类型体操。
 *
 * 查询异常时故障安全降级为仅当前部门（Default-Deny 最小权限）。
 *
 * @param deptId 根部门 ID
 * @returns 本部门 + 子部门 ID 列表；异常时返回 `[deptId]`
 */
async function getSubDepartmentIds(deptId: string): Promise<string[]> {
  try {
    const result = await db
      .select({ id: schema.departments.id })
      .from(schema.departments)
      .where(
        or(
          eq(schema.departments.id, deptId),
          like(schema.departments.ancestors, `${deptId}/%`),
        ),
      );
    return result.map((r) => r.id);
  } catch (error) {
    console.error('[DataScope] getSubDepartmentIds 查询异常:', error);
    return [deptId];
  }
}

/**
 * CUSTOM 范围：按角色 ID 列表查 role_data_scopes，返回去重后的部门 ID 列表
 */
async function getCustomDeptIds(roleIds: string[]): Promise<string[]> {
  if (roleIds.length === 0) return [];
  const result = await db
    .selectDistinct({ deptId: schema.roleDataScopes.deptId })
    .from(schema.roleDataScopes)
    .where(inArray(schema.roleDataScopes.roleId, roleIds));
  return result.map((r) => r.deptId);
}

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
  const scope = await resolveScope(userId);
  if (!scope) return { type: 'LIST', deptIds: [] };

  switch (scope.dataScopeType) {
    case 'ALL':
      return { type: 'ALL' };
    case 'SELF':
      return { type: 'SELF' };
    case 'DEPT':
      return { type: 'LIST', deptIds: scope.deptId ? [scope.deptId] : [] };
    case 'DEPT_AND_SUB': {
      if (!scope.deptId) return { type: 'LIST', deptIds: [] };
      return { type: 'LIST', deptIds: await getSubDepartmentIds(scope.deptId) };
    }
    case 'CUSTOM': {
      const roleIds = await scope.fetchRoleIds();
      return { type: 'LIST', deptIds: await getCustomDeptIds(roleIds) };
    }
    default:
      return { type: 'LIST', deptIds: [] };
  }
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
  const scope = await resolveScope(userId);
  if (!scope) return false;

  switch (scope.dataScopeType) {
    case 'ALL':
      return true;

    case 'SELF':
      // 精准限制：操作用户与目标资源拥有者必须严格相等
      return !!targetUserId && userId === targetUserId;

    case 'DEPT':
      return scope.deptId === targetDeptId;

    case 'DEPT_AND_SUB': {
      if (!scope.deptId) return false;
      // 同部门直接通过，短路避免 CTE 查询
      if (scope.deptId === targetDeptId) return true;
      const ids = await getSubDepartmentIds(scope.deptId);
      return ids.includes(targetDeptId);
    }

    case 'CUSTOM': {
      const roleIds = await scope.fetchRoleIds();
      if (roleIds.length === 0) return false;

      const result = await db
        .select()
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
