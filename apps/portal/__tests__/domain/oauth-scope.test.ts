/**
 * OAuth scope 领域规则
 * @req H-AUTH-004
 */
import { describe, expect, it } from 'vitest';
import { InvalidScopeError, parseScopes, validateRequestedScopes } from '@/domain/auth/oauth-authorize';

describe('OAuth scope 领域规则', () => {
  it('按空白字符解析并去重 scope', () => {
    expect(parseScopes('openid  profile\temail profile')).toEqual(['openid', 'profile', 'email']);
  });

  it('拒绝 client 未注册的 scope', () => {
    expect(() => validateRequestedScopes(['openid', 'email'], ['openid'])).toThrow(InvalidScopeError);
  });

  it('精确匹配 openid，不把 notopenid 当作 openid', () => {
    expect(parseScopes('notopenid profile')).not.toContain('openid');
  });
});
