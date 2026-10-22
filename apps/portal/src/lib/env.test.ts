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
  resetConfig,
  resolvePublicUrls,
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
    // getter 已走模块级缓存单例：env 变更后必须重置，防止跨用例串味
    resetConfig();
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
    resetConfig();
  });

  it('resolves non-database settings without DATABASE_URL', () => {
    Reflect.set(process.env, 'NODE_ENV', 'production');
    Reflect.set(process.env, 'NEXT_PUBLIC_APP_URL', 'https://sso.example.com/');
    Reflect.set(process.env, 'PORTAL_ISSUER', 'https://issuer.example.com/');
    Reflect.set(process.env, 'GATEWAY_SHARED_SECRET', 'gateway-secret');

    expect(getAppBaseURL()).toBe('https://sso.example.com');
    // 2026-10-13 更正（架构评审 R2 次级候选「公开 URL 推导」）：此前这里期望
    // 'https://issuer.example.com/'（**保留**尾斜杠），把 getIssuer 与 getAppBaseURL
    // 判据不一致这件事写成了规范。ADR-012 要求 issuer 与取 Discovery 的 URL 同源，
    // 保留尾斜杠会让严格的 OIDC RP 以 issuer 不匹配拒绝登录 ⇒ 现已统一去尾斜杠。
    expect(getIssuer()).toBe('https://issuer.example.com');
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

/**
 * 公开 URL 推导：**纯函数直接注入 env**，不碰 `process.env` 与全局缓存单例。
 *
 * 这是本候选的核心收益——原先前者的唯一注入入口 `parsePortalEnv` 零消费者，
 * 实际被消费的是读缓存单例的 getter，于是推导只能靠「改 env + `resetConfig()`」来测。
 */
describe('resolvePublicUrls（纯函数，接受 env 注入）', () => {
  it('三个公开 URL 一律去掉尾斜杠（含首尾空白与多重斜杠）', () => {
    expect(
      resolvePublicUrls({
        NEXT_PUBLIC_APP_URL: ' https://sso.example.com// ',
        PORTAL_ISSUER: 'https://issuer.example.com/',
        PORTAL_JWKS_URI: 'https://issuer.example.com/api/auth/jwks///',
      }),
    ).toEqual({
      appBaseURL: 'https://sso.example.com',
      issuer: 'https://issuer.example.com',
      jwksUri: 'https://issuer.example.com/api/auth/jwks',
    });
  });

  it('未显式配置时按 ADR-012 默认推导（issuer 与 Discovery 同源）', () => {
    expect(
      resolvePublicUrls({
        NEXT_PUBLIC_APP_URL: 'https://sso.example.com/',
        PORTAL_ISSUER: undefined,
        PORTAL_JWKS_URI: undefined,
      }),
    ).toEqual({
      appBaseURL: 'https://sso.example.com',
      issuer: 'https://sso.example.com',
      jwksUri: 'https://sso.example.com/api/auth/jwks',
    });
  });

  it('**issuer 恒与取 metadata 的基址同源**：尾斜杠不得让它变成另一个字符串', () => {
    const base = 'https://sso.example.com';
    for (const raw of [base, `${base}/`, `${base}//`, ` ${base}/ `]) {
      const { issuer, appBaseURL } = resolvePublicUrls({
        NEXT_PUBLIC_APP_URL: base,
        PORTAL_ISSUER: raw,
        PORTAL_JWKS_URI: undefined,
      });
      expect(issuer).toBe(base);
      // 与 getter 侧的默认结论一致（两者同源才有意义）
      expect(issuer).toBe(appBaseURL);
    }
  });
});
