/**
 * OIDC Discovery 协议契约回归
 *
 * @req US-OIDC-01, H-SESS-002
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/.well-known/openid-configuration/route';

const ENV_KEYS = ['NODE_ENV', 'NEXT_PUBLIC_APP_URL', 'PORTAL_ISSUER'] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

describe('GET /.well-known/openid-configuration', () => {
  beforeEach(() => {
    Reflect.set(process.env, 'NODE_ENV', 'production');
    Reflect.set(process.env, 'NEXT_PUBLIC_APP_URL', 'https://sso.example.com/');
    Reflect.deleteProperty(process.env, 'PORTAL_ISSUER');
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else Reflect.set(process.env, key, value);
    }
  });

  it('issuer 使用公开 HTTPS URL 且所有端点来自同一基础地址', async () => {
    const response = await GET();
    const metadata = await response.json();

    expect(metadata.issuer).toBe('https://sso.example.com');
    expect(metadata.authorization_endpoint).toBe(
      'https://sso.example.com/api/auth/oauth2/authorize',
    );
    expect(metadata.jwks_uri).toBe('https://sso.example.com/api/auth/jwks');
  });

  it('显式 issuer 覆盖值会被规范化', async () => {
    Reflect.set(process.env, 'PORTAL_ISSUER', 'https://issuer.example.com/oidc/');

    const response = await GET();
    const metadata = await response.json();

    expect(metadata.issuer).toBe('https://issuer.example.com/oidc');
  });
});
