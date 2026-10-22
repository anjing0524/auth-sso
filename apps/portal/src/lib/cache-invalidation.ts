import 'server-only';

/**
 * 写后缓存失效 (Post-write Cache Invalidation)
 *
 * 每个写操作结束后必须失效两样东西：被写资源页面路由（`revalidatePath`）与
 * 读模型缓存标签。本模块是这两件事的**唯一真相源**。
 *
 * ## 为什么需要它
 *
 * 失效原先在 22 个 action / route 里手写，共 34 处，其中包含一处**跨资源依赖**
 * 极易漏掉：`users/data.ts` 的 `getDepartmentOptions()` 带 `cacheTag('departments')`
 * 且 `cacheLife('hours')` —— 部门变更若忘了失效该标签，用户表单的部门下拉框最长
 * 会陈旧一小时。这类"A 资源变更需失效 B 资源标签"的关系散落在调用点就一定会漏，
 * 集中在资源定义旁边才不会。
 *
 * ## 两个具名入口：写入位置决定用哪个原语
 *
 * Next.js 对两个标签失效原语的可用位置有硬性限制：
 *
 * | 原语 | Server Action | Route Handler | 语义 |
 * |---|---|---|---|
 * | `updateTag` | ✅ | ❌ **必抛 `E872`** | 立即过期，当前请求即可见新数据 |
 * | `revalidateTag` | ✅ | ✅ | 标记过期，按 profile 决定陈旧窗口 |
 *
 * 因此写入位置**不是**可以内部自动探测的实现细节——探测不到就会在 Route Handler 里
 * 抛错（写已提交、失效未发生、响应 5xx）。这里按本仓既有纪律（**维度用函数名编码，
 * 不用条件参数化**）给出两个具名入口，调用方 grep 函数名即知自己该用哪个：
 *
 * - Server Action → {@link invalidateResource}
 * - Route Handler → {@link invalidateResourceFromRoute}
 *
 * ## 约定
 *
 * - `-list` 后缀标签供列表读模型使用（`cacheTag('<resource>-list')`）。
 * - 无后缀标签用于跨资源的局部读模型（如 `departments` 供用户表单下拉框）。
 *
 * @module lib/cache-invalidation
 */
import { revalidatePath, revalidateTag, updateTag } from 'next/cache';

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
  // 改自己的资料（name / email / avatarUrl）会显示在**用户列表**里，
  // 故除本页路径外必须一并失效 users-list；此前 tags 为空数组，列表不刷新。
  profile: { path: '/profile', tags: ['users-list'] },
};

export type InvalidatableResource = keyof typeof INVALIDATION;

/**
 * 资源表 + 页面路径的唯一装配点，两个入口共用。
 *
 * 未知资源抛出：拼错资源名若静默无事发生，会表现为"偶尔的陈旧 UI"——
 * 宁可在开发期立刻失败。
 */
function applyInvalidation(
  resource: InvalidatableResource,
  extraPaths: readonly string[],
  expireTag: (tag: string) => void,
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
    expireTag(tag);
  }
}

/**
 * **Server Action 内**的写后失效：用 `updateTag`（立即过期）。
 *
 * @param resource 被写的资源
 * @param extraPaths 额外路径（如含实体 ID 的详情页，无法预置在静态表里）
 */
export function invalidateResource(
  resource: InvalidatableResource,
  extraPaths: readonly string[] = [],
): void {
  applyInvalidation(resource, extraPaths, updateTag);
}

/**
 * **Route Handler 内**的写后失效：用 `revalidateTag(tag, { expire: 0 })`。
 *
 * 不能复用 {@link invalidateResource}：`updateTag` 在 route 上下文必抛
 * （Next.js `E872`），而抛出点在写事务提交之后——结果是写成功、失效未发生、
 * 响应 5xx，并诱使调用方重试。
 *
 * 第二参取 `{ expire: 0 }` 而非官方默认推荐的 `'max'`：`'max'` 是
 * stale-while-revalidate（先服务陈旧内容、后台再验证），而这些写入是
 * 权限 / 会话 / 配置类变更，**陈旧内容本身就是错的**。官方文档对该取值的
 * 说明正是本场景：「调用方需要数据立即失效、但无法使用 `updateTag` 时使用」。
 *
 * @param resource 被写的资源
 * @param extraPaths 额外路径（如含实体 ID 的详情页）
 */
export function invalidateResourceFromRoute(
  resource: InvalidatableResource,
  extraPaths: readonly string[] = [],
): void {
  applyInvalidation(resource, extraPaths, tag => revalidateTag(tag, { expire: 0 }));
}
