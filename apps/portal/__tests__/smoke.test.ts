/**
 * Portal Vitest 冒烟测试
 * 验证测试框架基础设施正常工作
 *
 * @req A-NAV-01
 */
import { describe, it, expect } from 'vitest';

describe('Vitest 冒烟测试', () => {
  it('基础断言工作正常', () => {
    expect(1 + 1).toBe(2);
  });

  it('server-only mock 生效（不抛异常）', async () => {
    // 如果 server-only mock 未生效，此 import 会抛出异常
    const mod = await import('server-only');
    expect(mod).toBeDefined();
  });
});
