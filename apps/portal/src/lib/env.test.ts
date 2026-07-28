/**
 * @req Portal runtime configuration boundary regression
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getAppBaseURL,
  getDatabaseUrl,
  getGatewaySharedSecret,
  getIssuer,
  getJwksUri,
  getRedisUrl,
  getTrustedOrigins,
  isCookieSecure,
} from '@auth-sso/config';

const ENV_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'NEXT_PUBLIC_APP_URL',
  'PORTAL_ISSUER',
  'PORTAL_JWKS_URI',
  'TRUSTED_ORIGINS',
  'GATEWAY_SHARED_SECRET',
  'COOKIE_SECURE',
  'NODE_ENV',
] as const;

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

describe('runtime configuration boundaries', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) Reflect.deleteProperty(process.env, key);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        Reflect.set(process.env, key, value);
      }
    }
  });

  it('resolves non-database settings without DATABASE_URL', () => {
    Reflect.set(process.env, 'NODE_ENV', 'production');
    Reflect.set(process.env, 'NEXT_PUBLIC_APP_URL', 'https://sso.example.com/');
    Reflect.set(process.env, 'PORTAL_ISSUER', 'https://issuer.example.com/');
    Reflect.set(process.env, 'GATEWAY_SHARED_SECRET', 'gateway-secret');

    expect(getAppBaseURL()).toBe('https://sso.example.com');
    expect(getIssuer()).toBe('https://issuer.example.com/');
    expect(getJwksUri()).toBe('https://sso.example.com/api/auth/jwks');
    expect(getTrustedOrigins()).toEqual(['https://sso.example.com']);
    expect(getRedisUrl()).toBe('redis://localhost:6379');
    expect(getGatewaySharedSecret()).toBe('gateway-secret');
    expect(isCookieSecure()).toBe(true);
  });

  it('keeps DATABASE_URL validation scoped to database access', () => {
    expect(() => getDatabaseUrl()).toThrow();
  });
});
