/**
 * Auth-SSO 共享环境变量配置与 URL 推导模块 (Shared Env Config & URL Derivation)
 *
 * 职责：
 * 1. Zod Schema — 生产环境启动时 fail-fast 校验
 * 2. URL 推导函数 — 从已验证的配置单例读取，消除 process.env 双重读取路径
 *
 * 架构说明：IDP 已合并进 Portal，所有认证功能由 Portal 统一管理。
 * Portal 自身即是 OIDC Provider（纯自定义 JWT 实现，基于 jose 库，密钥对存 DB）。
 *
 * @module @auth-sso/config/env
 */

import { z } from 'zod';

const DEV_DEFAULT_PORT = '4100';
const DEV_DEFAULT_BASE_URL = `http://localhost:${DEV_DEFAULT_PORT}`;

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const portalEnvSchema = baseEnvSchema.extend({
  NEXT_PUBLIC_APP_NAME: z.string().default('Auth-SSO Portal'),
  NEXT_PUBLIC_APP_URL: z.string().url().default(DEV_DEFAULT_BASE_URL),
  PORTAL_CLIENT_SECRET: z.string().optional(),
  GATEWAY_SHARED_SECRET: z.string().optional(),
  PORTAL_ISSUER: z.string().optional(),
  PORTAL_JWKS_URI: z.string().optional(),
  TRUSTED_ORIGINS: z.string().optional(),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

export type PortalEnv = z.infer<typeof portalEnvSchema>;

const databaseEnvSchema = portalEnvSchema.pick({ DATABASE_URL: true });
const redisEnvSchema = portalEnvSchema.pick({ REDIS_URL: true });
const appUrlEnvSchema = portalEnvSchema.pick({ NEXT_PUBLIC_APP_URL: true });
const issuerEnvSchema = portalEnvSchema.pick({
  NEXT_PUBLIC_APP_URL: true,
  PORTAL_ISSUER: true,
});
const jwksEnvSchema = portalEnvSchema.pick({
  NEXT_PUBLIC_APP_URL: true,
  PORTAL_JWKS_URI: true,
});
const trustedOriginsEnvSchema = portalEnvSchema.pick({
  NODE_ENV: true,
  NEXT_PUBLIC_APP_URL: true,
  TRUSTED_ORIGINS: true,
});
const cookieEnvSchema = portalEnvSchema.pick({
  NODE_ENV: true,
  COOKIE_SECURE: true,
});
const gatewaySecretEnvSchema = portalEnvSchema.pick({
  GATEWAY_SHARED_SECRET: true,
});
const logLevelSchema = z.enum([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
]).default('info');

/** 已验证的配置单例 — 模块加载时惰性初始化 */
let _cached: PortalEnv | null = null;

function getConfig(): PortalEnv {
  if (!_cached) {
    _cached = portalEnvSchema.parse(process.env as Record<string, string | undefined>);
  }
  return _cached;
}

/** 重置配置缓存 — 供测试切换 env 使用 */
export function resetConfig(): void {
  _cached = null;
}

export function parsePortalEnv(env: Record<string, string | undefined>): PortalEnv {
  return portalEnvSchema.parse(env);
}

export function getEnvConfig(): PortalEnv {
  return getConfig();
}

export function getDatabaseUrl(): string {
  return databaseEnvSchema.parse(process.env).DATABASE_URL;
}

export function getLogLevel(): z.infer<typeof logLevelSchema> {
  return logLevelSchema.parse(process.env['LOG_LEVEL']);
}

export function isCookieSecure(env?: Partial<PortalEnv>): boolean {
  const cfg = env ?? cookieEnvSchema.parse(process.env);
  if (cfg.COOKIE_SECURE === undefined) {
    return cfg.NODE_ENV === 'production';
  }
  return cfg.COOKIE_SECURE === true;
}

export function getAppBaseURL(): string {
  const { NEXT_PUBLIC_APP_URL } = appUrlEnvSchema.parse(process.env);
  return NEXT_PUBLIC_APP_URL.trim().replace(/\/+$/, '');
}

export function getIssuer(): string {
  const config = issuerEnvSchema.parse(process.env);
  const appBaseURL = config.NEXT_PUBLIC_APP_URL.trim().replace(/\/+$/, '');
  return (config.PORTAL_ISSUER || appBaseURL).trim();
}

export function getJwksUri(): string {
  const config = jwksEnvSchema.parse(process.env);
  const appBaseURL = config.NEXT_PUBLIC_APP_URL.trim().replace(/\/+$/, '');
  return (config.PORTAL_JWKS_URI || `${appBaseURL}/api/auth/jwks`).trim();
}

export function getTrustedOrigins(): string[] {
  const cfg = trustedOriginsEnvSchema.parse(process.env);
  if (cfg.TRUSTED_ORIGINS) {
    return cfg.TRUSTED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const origins = new Set<string>([getAppBaseURL()]);

  if (cfg.NODE_ENV !== 'production') {
    ['4000', '4100'].forEach((port) => {
      origins.add(`http://localhost:${port}`);
      origins.add(`http://127.0.0.1:${port}`);
    });
  }

  return Array.from(origins);
}

export function getRedisUrl(): string {
  return redisEnvSchema.parse(process.env).REDIS_URL.trim();
}

export function getGatewaySharedSecret(): string | null {
  return gatewaySecretEnvSchema.parse(process.env).GATEWAY_SHARED_SECRET || null;
}
