// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { sanitizeIp } from '@/lib/audit';

/**
 * @req 不涉及业务需求矩阵，为 inet 列写入安全单测
 */
describe('sanitizeIp', () => {
  it('合法 IPv4 原样返回', () => {
    expect(sanitizeIp('203.0.113.7')).toBe('203.0.113.7');
  });

  it('合法 IPv6 原样返回', () => {
    expect(sanitizeIp('2001:db8::1')).toBe('2001:db8::1');
  });

  it('代理链取首个 IP', () => {
    expect(sanitizeIp('203.0.113.7, 10.0.0.1')).toBe('203.0.113.7');
  });

  it('非法字符串返回 null，避免 inet 列写入失败', () => {
    expect(sanitizeIp('unknown')).toBeNull();
    expect(sanitizeIp('not-an-ip')).toBeNull();
    expect(sanitizeIp('')).toBeNull();
  });

  it('null/undefined 返回 null', () => {
    expect(sanitizeIp(null)).toBeNull();
    expect(sanitizeIp(undefined)).toBeNull();
  });
});
