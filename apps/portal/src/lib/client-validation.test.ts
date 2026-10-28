import { describe, expect, it } from 'vitest';
import { isHttpUrl, validateClientBasics } from './client-validation';

describe('client-validation', () => {
  it('isHttpUrl 只接受 http(s)', () => {
    expect(isHttpUrl('https://example.com/cb')).toBe(true);
    expect(isHttpUrl('http://localhost:3000/cb')).toBe(true);
    expect(isHttpUrl('ftp://example.com')).toBe(false);
    expect(isHttpUrl('not-a-url')).toBe(false);
  });

  it('名称/回调/Logo 校验与创建页同口径', () => {
    expect(validateClientBasics({ name: '', redirectUris: '' }).name).toBe('应用名称不能为空');
    expect(validateClientBasics({ name: 'a', redirectUris: '' }).redirectUris).toBe('至少需要一个回调地址');
    expect(validateClientBasics({ name: 'a', redirectUris: 'ftp://x' }).redirectUris).toContain('格式不合法');
    expect(validateClientBasics({ name: 'a', redirectUris: 'https://x/cb', logoUrl: 'bad' }).logoUrl).toContain('合法');
    expect(validateClientBasics({ name: 'a', redirectUris: 'https://x/cb' })).toEqual({});
  });
});
