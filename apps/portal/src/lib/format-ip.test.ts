import { describe, expect, it } from 'vitest';
import { formatIp } from './format-ip';

describe('formatIp', () => {
  it('IPv4-mapped IPv6 归一为 IPv4', () => {
    expect(formatIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(formatIp('::ffff:192.168.97.1')).toBe('192.168.97.1');
  });
  it('普通 IPv4/IPv6 与空值', () => {
    expect(formatIp('10.0.0.1')).toBe('10.0.0.1');
    expect(formatIp('2001:db8::1')).toBe('2001:db8::1');
    expect(formatIp(null)).toBe('-');
  });
});
