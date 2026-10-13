/**
 * OAuth token 响应组装（纯函数）—— 直测
 *
 * 钉住两条不变量：
 * 1. **`scope` 恒在**（RFC 6749 §5.1；此前 refresh 分支手拼响应时漏了它）；
 * 2. 可选字段**缺席即不出现**（不得写出 `refresh_token: undefined` 这类键——
 *    `exactOptionalPropertyTypes` 下条件展开是唯一合法写法，序列化后也不该有 null）。
 *
 * @req H-AUTH-003
 */
import { describe, it, expect } from 'vitest';
import { toOAuthTokenResponse } from '@/domain/auth/token-response';

describe('toOAuthTokenResponse', () => {
  it('恒产出协议骨架，且 scope 必须回报', () => {
    const r = toOAuthTokenResponse({ accessToken: 'at', expiresIn: 3600, scope: 'openid profile' });

    expect(r).toEqual({
      access_token: 'at',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'openid profile',
    });
  });

  it('可选字段缺席时**不出现该键**（而非值为 undefined）', () => {
    const r = toOAuthTokenResponse({ accessToken: 'at', expiresIn: 60, scope: 'openid' });

    expect(Object.keys(r).sort()).toEqual(['access_token', 'expires_in', 'scope', 'token_type']);
    expect(JSON.parse(JSON.stringify(r))).not.toHaveProperty('refresh_token');
    expect(JSON.parse(JSON.stringify(r))).not.toHaveProperty('id_token');
  });

  it('有 refresh_token / id_token 时原样带上（轮换与授权码两族共用一本组装）', () => {
    const r = toOAuthTokenResponse({
      accessToken: 'at',
      expiresIn: 3600,
      refreshToken: 'rt',
      idToken: 'idt',
      scope: 'openid offline_access',
    });

    expect(r.refresh_token).toBe('rt');
    expect(r.id_token).toBe('idt');
    expect(r.scope).toBe('openid offline_access');
  });

  it('空字符串的可选字段视为缺席（不写出空值键）', () => {
    const r = toOAuthTokenResponse({
      accessToken: 'at',
      expiresIn: 60,
      refreshToken: '',
      scope: 'openid',
    });

    expect(r).not.toHaveProperty('refresh_token');
  });
});
