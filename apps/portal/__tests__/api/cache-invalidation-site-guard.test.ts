/**
 * 机械守卫：Route Handler 不得使用 Server Action 专用的写后失效入口
 *
 * `invalidateResource` 走 `updateTag`，该原语在 route 上下文**必抛**（Next.js
 * `E872`），且抛出点在写事务提交之后 —— 形态是「写成功 + 失效未发生 + 响应 5xx」。
 * 本仓真实发生过 3 处：`users/[id]/roles` 的 POST 与 DELETE、`users/[id]/force-logout`
 * 的 POST（三处都在提交后抛错）。
 *
 * **为什么造机械检查而不是写进规范**：这是只由 diff 就能判定的模式
 * （`docs/coding-standards.md` §7）。而且它的失败模式在单测里不可观测——
 * `vitest.setup.ts` 把 `next/cache` 整体换成空实现，`updateTag` 永不抛。
 *
 * 纯 fs 扫描，无需基础设施（与 `module-mock-guard.test.ts` 同一形状）。
 *
 * @req H-CFG-001
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { REPO_ROOT, assertScannedNonEmpty, isCommentLine, walk } from '../helpers/repo-scan';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_DIR = join(REPO_ROOT, 'apps/portal/src/app/api');

/** 仅 Server Action 可用的入口：`invalidateResource(`（`invalidateResourceFromRoute(` 不匹配） */
const ACTION_ONLY_CALL = /\binvalidateResource\s*\(/;
/** `updateTag` 本身在 route 文件里出现即是违规（无论直接调用还是 import） */
const UPDATE_TAG = /\bupdateTag\b/;


/** 纯函数：产出 route 源码中「Server Action 专用入口」的点位（行号 1-based） */
function findActionOnlyInvalidations(source: string): number[] {
  const found: number[] = [];
  source.split('\n').forEach((line, index) => {
    if (isCommentLine(line, 'invalidateResource')) return;
    if (ACTION_ONLY_CALL.test(line)) found.push(index + 1);
  });
  return found;
}

/** 纯函数：产出 route 源码中直接触碰 `updateTag` 的点位（行号 1-based） */
function findDirectUpdateTag(source: string): number[] {
  const found: number[] = [];
  source.split('\n').forEach((line, index) => {
    if (isCommentLine(line, 'updateTag')) return;
    if (UPDATE_TAG.test(line)) found.push(index + 1);
  });
  return found;
}

/** 全部 Route Handler（`src/app/api/**\/route.ts`） */
const ROUTE_FILES = walk(API_DIR, (name) => name === 'route.ts').map((abs) => ({
  abs,
  rel: relative(REPO_ROOT, abs),
}));

describe('扫描器自身（夹具）', () => {
  it('Server Action 专用入口被点名', () => {
    expect(findActionOnlyInvalidations("invalidateResource('users');")).toEqual([1]);
  });

  it('route 版入口不被误报', () => {
    expect(findActionOnlyInvalidations("invalidateResourceFromRoute('users');")).toEqual([]);
  });

  it('注释里叙述该入口不算点位', () => {
    expect(findActionOnlyInvalidations('// 这里不能用 invalidateResource(\'users\')')).toEqual([]);
  });

  it('直接使用 updateTag 被点名', () => {
    expect(findDirectUpdateTag("import { updateTag } from 'next/cache';")).toEqual([1]);
  });
});

describe('Route Handler 的写后失效入口', () => {
  it('至少扫到 route 文件（守卫不得空转）', () => {
    assertScannedNonEmpty(ROUTE_FILES, 'apps/portal/src/app/api 下的 route.ts（缓存失效点位扫描范围）', 10);
  });

  it('没有任何 route.ts 使用 Server Action 专用入口', () => {
    const violations = ROUTE_FILES.flatMap(({ abs, rel }) =>
      findActionOnlyInvalidations(readFileSync(abs, 'utf-8')).map((line) => `${rel}:${line}`),
    );

    expect(violations).toEqual([]);
  });

  it('没有任何 route.ts 直接触碰 updateTag', () => {
    const violations = ROUTE_FILES.flatMap(({ abs, rel }) =>
      findDirectUpdateTag(readFileSync(abs, 'utf-8')).map((line) => `${rel}:${line}`),
    );

    expect(violations).toEqual([]);
  });

  it('确有 route 走 route 版入口（正向对照：否则前两条是空转）', () => {
    const users = ROUTE_FILES.filter(({ abs }) =>
      readFileSync(abs, 'utf-8').includes('invalidateResourceFromRoute('),
    );

    expect(users.map(({ rel }) => rel).sort()).toEqual([
      'apps/portal/src/app/api/permissions/register/route.ts',
      'apps/portal/src/app/api/roles/[id]/permissions/route.ts',
      'apps/portal/src/app/api/users/[id]/force-logout/route.ts',
      'apps/portal/src/app/api/users/[id]/roles/route.ts',
    ]);
  });
});
