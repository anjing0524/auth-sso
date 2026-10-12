/**
 * 强制下线端点的响应契约（撤销走真实 Redis 状态）
 *
 * ## 为什么需要它
 *
 * `POST /api/users/[id]/force-logout` 的响应承诺告知管理员「本次撤销了多少个
 * Access Token JTI」。历史上实现里存在一次**重复撤销**（**已修复**：路由现在直接取
 * `revokeAllRefreshTokens` 的真实返回值）：
 *
 * 1. `revokeAllRefreshTokens(userId)` 内部已调用 `revokeUserAccessByUserId`
 *    （双层撤销闭环）
 * 2. 路由随后**又调用一次** `revokeUserAccessByUserId`，并把它当作计数来源
 *
 * 而 `revokeUserAccessByUserId` 是**幂等**的——它读完 `user_jti` 映射后
 * 执行 `pipeline.del(key)` 消费掉该映射。故第二次调用必然拿到空映射、返回 0。
 *
 * 结果：`revokedJtiCount` 恒为 0，响应里的「已撤销 N 个 Access Token JTI」
 * 永远显示 0，与实际撤销数量无关（N 个 AT 确实被撤销了，只是数字报错）。
 *
 * 本文件以**响应契约**为接缝锁住这个数字的真实性：用**真实 Redis 的 `user_jti` 播种**给出
 * "该用户当时持有 N 个 AT"这一前提，再断言真实撤销数量与真实黑名单效果（#57 之前这里用
 * mock 喂计数，锁的只是响应投影，对"撤销真的撤了几个"没有判别力）。
 *
 * @req H-SESS-004, H-SESS-006
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedRootDept, seedAdminUser } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';

const { mocks, tdHolder } = vi.hoisted(() => ({
  mocks: {
    mockClearPermCache: vi.fn(async () => {}),
  },
  tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
}));

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

// @allow-module-mock @/lib/permissions input-fixture: 只提供权限上下文输入；真实 PG 驱动的分级由 permission-enforcement / rt-permission-failure 覆盖
vi.mock(import('@/lib/permissions'), (): Partial<typeof permissionsModule> => ({
  getUserPermissionContext: vi.fn(async () => ({ kind: 'ok' as const, context: { roles: [], permissions: [], deptIds: [] } })),
  cacheUserPermissionContext: vi.fn(async () => {}),
  clearUserPermissionCache: mocks.mockClearPermCache,
}));

// 权限门面与数据范围守卫：本文件测的是响应契约，非鉴权（后者另有覆盖）
// @allow-module-mock @/lib/auth auth-bypass: 本文件被测语义不依赖登录/授权链路，mock 仅用于构造"已登录/已授权"的请求上下文（依赖它的断言：force-logout-route.test.ts 全部用例）
vi.mock(import('@/lib/auth'), (): Partial<typeof authModule> => ({
  withPermission: (_opts, handler) => handler('00000000-0000-4000-8000-000000000101'),
}));

// @allow-module-mock @/lib/authz input-fixture: 数据范围写路径只提供"直接执行回调"这一输入；真实范围快照由 lib/authz 自身测试覆盖
vi.mock(import('@/lib/authz'), (): Partial<typeof authzModule> => ({
  // mock 只负责"直接执行回调"；事务对象由生产签名决定，测试内没有真实事务可用
  withScopedWrite: async (_opts, write) => write(undefined as never),
}));

// @allow-module-mock @/lib/cache-invalidation infra-boundary: 缓存失效是旁路副作用，不影响本文件断言的响应契约
vi.mock(import('@/lib/cache-invalidation'), (): Partial<typeof cacheInvalidationModule> => ({ invalidateResource: vi.fn() }));

import { POST } from '@/app/api/users/[id]/force-logout/route';
import { isJtiRevoked, revokeUserAccessByUserId, trackUserJti } from '@/lib/session/revoke';
import { NextRequest } from 'next/server';
import type * as permissionsModule from '@/lib/permissions';
import type * as authModule from '@/lib/auth';
import type * as authzModule from '@/lib/authz';
import type * as cacheInvalidationModule from '@/lib/cache-invalidation';

const td = createTestDbHandle();
tdHolder.current = td;

const ADMIN_ID = '00000000-0000-4000-8000-000000000101';

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  vi.clearAllMocks();
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedAdminUser(),
  });
});

function forceLogoutRequest(): NextRequest {
  return new NextRequest(`http://localhost:4100/api/users/${ADMIN_ID}/force-logout`, {
    method: 'POST',
  });
}

async function callRoute(): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await POST(forceLogoutRequest(), { params: Promise.resolve({ id: ADMIN_ID }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('POST /api/users/[id]/force-logout — 响应契约', () => {
  it('**响应中的 revokedJtiCount 必须等于实际撤销的 JTI 数量**', async () => {
    // 前提（真实状态）：该用户当时持有 3 个未过期 AT
    const jtis = ['jti-a', 'jti-b', 'jti-c'];
    for (const jti of jtis) await trackUserJti(ADMIN_ID, jti, 3600);

    const { body } = await callRoute();

    // 结论 1：数量如实出现在 body 与 message 中（响应投影）
    expect(body['revokedJtiCount']).toBe(3);
    expect(String(body['message'])).toContain('3');
    // 结论 2：这 3 个 jti **真的**进了黑名单（真实效果，不只是数字）
    for (const jti of jtis) await expect(isJtiRevoked(jti)).resolves.toBe(true);
  });

  it('**计数取自唯一一次消费**（该原语幂等：再消费一次只会得到 0）', async () => {
    for (const jti of ['jti-x', 'jti-y', 'jti-z']) await trackUserJti(ADMIN_ID, jti, 3600);

    const { body } = await callRoute();
    expect(body['revokedJtiCount']).toBe(3);

    // 显式证成前提：该原语是幂等的——消费掉映射后再调一次只会拿到 0。
    // 因此"计数仍为 3"本身就是"路由只撤销了一次"的行为证据（此前靠调用次数断言）。
    await expect(revokeUserAccessByUserId(ADMIN_ID)).resolves.toBe(0);
  });

  it('撤销 0 个 JTI 时如实报告 0（不得伪造数字）', async () => {
    // 不播种：该用户没有在册的 AT
    const { body } = await callRoute();

    expect(body['revokedJtiCount']).toBe(0);
  });

  it('用户不存在 → 404，且不执行任何撤销', async () => {
    const ghostId = '00000000-0000-4000-8000-00000000dead';

    // **调用前**播种：判别力来自"有东西可丢却没丢"——撤销会 `del` 掉整张映射。
    // （此前只断言 `isJtiRevoked('jti-untouched')===false`，而那个 jti 从未播种，
    //   任何实现都写不进黑名单；若把播种放到调用之后，映射是调用后才存在的，
    //   "未被消费"同样恒真——两个版本都没有判别力。）
    await trackUserJti(ghostId, 'jti-of-ghost', 3600);

    const res = await POST(forceLogoutRequest(), {
      params: Promise.resolve({ id: ghostId }),
    });

    expect(res.status).toBe(404);
    await expect(isJtiRevoked('jti-of-ghost')).resolves.toBe(false);
    // 映射仍在册 ⇒ 确实没有执行任何撤销（消费掉就会返回 0）
    await expect(revokeUserAccessByUserId(ghostId)).resolves.toBe(1);
  });
});
