/** 安全端点浏览器冒烟测试。 */
import { expect, test } from '@playwright/test';

test.describe('安全端点冒烟', () => {
  test('未认证、伪造和过期令牌均不能访问当前用户端点', async ({ request }) => {
    const requests = [
      request.get('/api/me'),
      request.get('/api/me', { headers: { Authorization: 'Bearer fake-jwt-token-12345' } }),
      request.get('/api/me', {
        headers: {
          cookie: 'portal_jwt_token=eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ0ZXN0IiwiZXhwIjoxMDAwMDAwMDAwfQ.fake',
        },
      }),
    ];

    for (const response of await Promise.all(requests)) {
      expect(response.status()).toBe(401);
    }
  });

  test('OIDC Discovery 与 JWKS 仅暴露公开签名信息', async ({ request }) => {
    const discovery = await request.get('/.well-known/openid-configuration');
    expect(discovery.status()).toBe(200);
    const document = await discovery.json();
    expect(document.authorization_endpoint).toBeDefined();
    expect(document.token_endpoint).toBeDefined();
    expect(document.jwks_uri).toBeDefined();
    expect(document.code_challenge_methods_supported).toContain('S256');

    const jwks = await request.get('/api/auth/jwks');
    expect(jwks.status()).toBe(200);
    const { keys } = await jwks.json();
    expect(keys).not.toHaveLength(0);
    for (const key of keys) {
      expect(key).toMatchObject({ kty: 'EC', crv: 'P-256', use: 'sig', alg: 'ES256' });
      expect(key.kid).toBeTruthy();
      expect(key.d).toBeUndefined();
    }
  });
});
