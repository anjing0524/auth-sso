/**
 * 守卫：读会话的路由必须显式声明 `export const instant = false`
 *
 * ## 背景（Turbopack 运行时实测，不是假想）
 *
 * `apps/portal` 开启了 Cache Components（`next.config.ts` 的 `cacheComponents: true`）。
 * 在**现代 glibc 环境**用 Turbopack 起 dev（本沙箱 glibc 2.28 太旧，改用 `gcc:14` 容器
 * + 宿主机 Node 26 复现）后，访问 `/users`、`/roles` 等读会话的路由时服务端反复报：
 *
 * ```
 * Error: Route "/users": Next.js encountered uncached data during prerendering or a navigation.
 *   fetch(...) or connection() accessed outside of <Suspense> prevents the route from being
 *   prerendered ... [block] Set `export const instant = false` to allow a blocking route
 *     at verifyAccessToken (src/lib/auth/token.ts:165:40)
 *     at DashboardGroupLayout (src/app/(dashboard)/layout.tsx:60:7)
 * ```
 *
 * Next 16 文档（`authentication-with-cache-components.md`）明确：启用 `cacheComponents`
 * 后，instant 导航校验会标记**每一个读 session 的路由**；推荐用
 * `export const instant = false` 声明"保留服务端阻塞"，再逐路由迁移。
 * 本仓是"全部页面都要登录"的管理后台，因此除纯客户端页面外，每个 `page/layout`
 * 都应声明该导出——把这条约定做成机械守卫，避免新页面漏声明后**只在 Turbopack
 * 运行时**才暴露（webpack dev 下不报）。
 *
 * ## 判据
 *
 * 扫描 `apps/portal/src/app` 下的 `page.tsx` 与 `layout.tsx`：**第一个非注释语句**是
 * `'use client'` 的跳过（不能只看前 3 行——本仓多个页面把 JSDoc 放在 `'use client'` 之前，
 * 首版守卫因此漏判，把 `export const instant` 加进了 client 页面，实测 500：
 * `"instant" is a route segment config and can only be used when the segment is a Server Component module`）；
 * 其余文件必须包含 `export const instant = false`。
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO_ROOT, walk } from '../helpers/repo-scan';

const APP_DIR = join(REPO_ROOT, 'apps/portal/src/app');

function routeFiles(): string[] {
  const isRoute = (name: string) => name === 'page.tsx' || name === 'layout.tsx';
  return walk(APP_DIR, isRoute).sort();
}

/** 去掉文件开头的注释（块注释/行注释）后，看第一个语句是不是 'use client' */
function isClientComponent(source: string): boolean {
  let rest = source.trimStart();
  for (;;) {
    if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/');
      if (end === -1) return false;
      rest = rest.slice(end + 2).trimStart();
      continue;
    }
    if (rest.startsWith('//')) {
      const nl = rest.indexOf('\n');
      rest = nl === -1 ? '' : rest.slice(nl + 1).trimStart();
      continue;
    }
    break;
  }
  return /^['"]use client['"]/.test(rest);
}

describe('instant 路由声明守卫（Cache Components + 读会话路由）', () => {
  it('扫描到的路由文件数不为 0（反空转）', () => {
    expect(routeFiles().length).toBeGreaterThanOrEqual(15);
  });

  it('每个非纯客户端 page/layout 都声明了 export const instant = false', () => {
    const violations = routeFiles()
      .filter((file) => !isClientComponent(readFileSync(file, 'utf8')))
      .filter((file) => !readFileSync(file, 'utf8').includes('export const instant = false'))
      .map((file) => relative(REPO_ROOT, file));
    expect(violations.join('\n'), '以下路由读取会话但未声明 instant = false（Turbopack 运行时会报 uncached data）').toBe('');
  });
});
