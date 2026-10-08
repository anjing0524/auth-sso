import 'server-only';

/**
 * 写后缓存失效 (Post-write Cache Invalidation)
 *
 * 每个写操作结束后必须失效两样东西：被写资源页面路由（`revalidatePath`）与
 * 读模型缓存标签（`updateTag`）。本模块是这两件事的**唯一真相源**。
 *
 * ## 为什么需要它
 *
 * 失效原先在 22 个 action / route 里手写，共 34 处，其中包含一处**跨资源依赖**
 * 极易漏掉：`users/data.ts` 的 `getDepartmentOptions()` 带 `cacheTag('departments')`
 * 且 `cacheLife('hours')` —— 部门变更若忘了失效该标签，用户表单的部门下拉框最长
 * 会陈旧一小时。这类"A 资源变更需失效 B 资源标签"的关系散落在调用点就一定会漏，
 * 集中在资源定义旁边才不会。
 *
 * ## 约定
 *
 * - `-list` 后缀标签供列表读模型使用（`cacheTag('<resource>-list')`）。
 * - 无后缀标签用于跨资源的局部读模型（如 `departments` 供用户表单下拉框）。
 *
 * @module lib/cache-invalidation
 */
import { revalidatePath, updateTag } from 'next/cache';

/** 资源 → 页面路由 与 需失效的读模型标签 */
const INVALIDATION: Record<string, { path: string; tags: readonly string[] }> = {
  users: { path: '/users', tags: ['users-list'] },
  roles: { path: '/roles', tags: ['roles-list'] },
  permissions: { path: '/permissions', tags: ['permissions-list'] },
  clients: { path: '/clients', tags: ['clients-list'] },
  departments: {
    path: '/departments',
    // `departments`（无后缀）是跨资源依赖：用户表单的部门下拉框
    // （users/data.ts 的 getDepartmentOptions）以它作标签。
    tags: ['departments-list', 'departments'],
  },
  profile: { path: '/profile', tags: [] },
};

export type InvalidatableResource = keyof typeof INVALIDATION;

/**
 * 失效指定资源的页面路由与读模型标签。
 *
 * 未知资源抛出：拼错资源名若静默无事发生，会表现为"偶尔的陈旧 UI"——
 * 宁可在开发期立刻失败。
 */
export function invalidateResource(
  resource: InvalidatableResource,
  /**
   * 额外需要失效的具体路径（如资源详情页）。
   *
   * 详情页路径含实体 ID，无法在静态表里预置，因此由调用方补充。
   * 之所以不提供"由调用方传全部路径"的重载：那会让调用方有机会漏掉列表路由。
   */
  extraPaths: readonly string[] = [],
): void {
  const entry = INVALIDATION[resource];
  if (!entry) {
    throw new Error(`未知的可失效资源: ${resource}`);
  }
  revalidatePath(entry.path);
  for (const path of extraPaths) {
    revalidatePath(path);
  }
  for (const tag of entry.tags) {
    updateTag(tag);
  }
}
