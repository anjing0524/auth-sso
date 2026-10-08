/**
 * 测试 mock 与真实签名的契约守卫
 *
 * ## 为什么需要它
 *
 * 候选 ⑪ 的核心缺陷是「seam 画好了，却没人跨过去」：测试里手写的 mock 与真实
 * 签名**各自演化**，于是测试固化的接口形状与生产不符。已发现的实例：
 * `withPermission` 的真实签名是 `(options, handler)` **两参**，而
 * `mock-factory.ts` 与 `user-actions.test.ts` 曾写成三参
 * `(_opts, _req, handler)`——测试全绿，因为工厂/适配器把多出的参数吞掉了。
 *
 * 这类分叉不会让任何测试变红，只会让测试保护一个不存在的接口。本文件用
 * `Function.length` 直接比对，使漂移立刻可见。
 *
 * 注：`Function.length` 统计的是**首个默认值之前**的形参个数，恰好适合校验
 * 必传参数个数。因此断言的是「至少这么多必传参数」，而非精确个数——
 * 多一个可选参数不应让本守卫变红。
 *
 * @req H-ACL-001
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/infrastructure/db', () => ({ db: {}, schema: {} }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/env', () => ({
  getGatewaySharedSecret: () => null,
  isCookieSecure: () => false,
}));

import { withAuth, withPermission } from '@/lib/auth';
import { createHoistedHolders } from '../helpers/mock-factory';

describe('withAuth / withPermission 的真实签名', () => {
  it('withAuth 首个必传参数是 options', () => {
    // (options, fn) —— 两参
    expect(withAuth.length).toBeGreaterThanOrEqual(2);
  });

  it('withPermission 是 (options, handler) 两参', () => {
    expect(withPermission.length).toBeGreaterThanOrEqual(2);
  });
});

describe('mock-factory 的 mock 必须镜像真实签名', () => {
  const mocks = createHoistedHolders().mockAuth as unknown as Record<
    string,
    (...a: never[]) => unknown
  >;

  it('**withPermission mock 的必传参数个数与真实签名一致**（此前多一个幽灵参数）', () => {
    const realArity = withPermission.length;
    const mockArity = (mocks['withPermission'] as unknown as { length: number }).length;

    // mock 内部是 vi.fn(async (_options, handler) => ...)，arity 应为 2；
    // 若有人再写成 (_opts, _req, handler) 则此处变红。
    expect(mockArity).toBeGreaterThanOrEqual(2);
    expect(mockArity).toBeLessThanOrEqual(realArity);
  });

  it('withAuth mock 的必传参数个数与真实签名一致', () => {
    const realArity = withAuth.length;
    const mockArity = (mocks['withAuth'] as unknown as { length: number }).length;

    expect(mockArity).toBeGreaterThanOrEqual(2);
    expect(mockArity).toBeLessThanOrEqual(realArity);
  });
});
