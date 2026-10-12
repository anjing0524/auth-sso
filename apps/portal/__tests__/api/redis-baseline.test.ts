/**
 * 真实 Redis 基线金丝雀（守卫守卫）
 *
 * API project 的「真实 Redis」必须是被强制的前提，而不是"恰好本机起了容器"。
 * 本文件逐条守住这个前提，任一条不成立都必须变红：
 *
 * 1. 生产 Redis 客户端（@/infrastructure/redis）真的能完成读写删往返——基本可用性；
 * 2. 全局 beforeEach 的 FLUSHDB 真的生效——用例隔离。
 *    第 2、3 例**必须成对且按此顺序**：前者写长 TTL 键，后者断言它已消失；
 *    单独运行第 3 例会因「前置用例未运行」直接失败，而不是静默通过；
 * 3. `isJtiRevoked(未撤销 jti) === false`——fail-close 生效时必红。
 *    缺 Redis 时 fail-close 会返回 true，于是"撤销"类断言天然为真、
 *    "未撤销"类负例变假红（混合信号）。这一例把该退化变成可观测的失败。
 *
 * @req H-SESS-006
 */
import { describe, it, expect } from 'vitest';
import { getRedis } from '@/infrastructure/redis';
import { isJtiRevoked } from '@/lib/session/revoke';

const ROUNDTRIP_KEY = 'portal:test:redis-baseline:roundtrip';
const FLUSH_CANARY_KEY = 'portal:test:redis-baseline:flush-canary';

/** 前一例是否已写入金丝雀键——让"必须成对"的约束显式化 */
let flushCanaryWritten = false;

describe('真实 Redis 基线', () => {
  it('生产客户端能完成真实的读写删往返', async () => {
    const redis = getRedis();

    await redis.setex(ROUNDTRIP_KEY, 30, 'ok');
    expect(await redis.get(ROUNDTRIP_KEY)).toBe('ok');
    expect(await redis.del(ROUNDTRIP_KEY)).toBe(1);
    expect(await redis.get(ROUNDTRIP_KEY)).toBeNull();
  });

  it('写入一个长 TTL 的键，供下一例验证全局 FLUSHDB 生效', async () => {
    const redis = getRedis();

    await redis.setex(FLUSH_CANARY_KEY, 300, 'written-by-previous-case');
    expect(await redis.get(FLUSH_CANARY_KEY)).toBe('written-by-previous-case');

    flushCanaryWritten = true;
  });

  it('全局 FLUSHDB 必须已清掉上一例写入的键', async () => {
    // 单独运行本例（-t 过滤）时该断言失败，避免"隔离验证"落空
    expect(flushCanaryWritten).toBe(true);

    const redis = getRedis();
    expect(await redis.get(FLUSH_CANARY_KEY)).toBeNull();
  });

  it('未撤销的 jti 必须返回 false（fail-close 生效时必红）', async () => {
    await expect(isJtiRevoked(`baseline-not-revoked-${Date.now()}`)).resolves.toBe(false);
  });
});
