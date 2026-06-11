/**
 * IdP Vitest 冒烟测试
 * 验证测试框架基础设施正常工作
 */
import { describe, it, expect } from 'vitest';

describe('IdP Vitest 冒烟测试', () => {
  it('基础断言工作正常', () => {
    expect(true).toBe(true);
  });

  it('server-only mock 生效', async () => {
    const mod = await import('server-only');
    expect(mod).toBeDefined();
  });
});
