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
const logLevelSchema = z.enum([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
]).default('info');

/**
 * Web 运行时缓存视图 — 单例 `getEnvConfig()` 的解析基础。
 *
 * 与 `portalEnvSchema` 的唯一差异：DATABASE_URL 放宽为可选。URL 推导 getter
 * （getIssuer/getAppBaseURL/getTrustedOrigins 等）走此缓存视图，保证在最小
 * env（脚本/单测只设少量变量）下仍可用；DATABASE_URL 的 fail-fast 校验由
 * `getDatabaseUrl()` 的专属 strict 解析独立承担，两者职责分离互不拖累。
 */
const runtimeConfigSchema = portalEnvSchema.extend({
  DATABASE_URL: z.string().url().optional(),
});

/** 已验证的配置单例 — 模块加载时惰性初始化 */
let _cached: z.infer<typeof runtimeConfigSchema> | null = null;

function getConfig(): z.infer<typeof runtimeConfigSchema> {
  if (!_cached) {
    _cached = runtimeConfigSchema.parse(process.env as Record<string, string | undefined>);
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

/** Web 运行时配置视图类型（DATABASE_URL 不经此视图消费，见 getDatabaseUrl） */
export type RuntimeEnv = z.infer<typeof runtimeConfigSchema>;

export function getEnvConfig(): RuntimeEnv {
  return getConfig();
}

// ── 公开 URL 推导：唯一实现（纯函数，接受 env 注入）──

/** `resolvePublicUrls` 需要的最小 env 切片 */
export type PublicUrlEnv = Pick<
  z.infer<typeof runtimeConfigSchema>,
  'NEXT_PUBLIC_APP_URL' | 'PORTAL_ISSUER' | 'PORTAL_JWKS_URI'
>;

export interface PublicUrls {
  /** 应用对外基址（无尾斜杠） */
  readonly appBaseURL: string;
  /** OIDC issuer（无尾斜杠）—— 必须与取 Discovery 的 URL 同源（ADR-012 / OIDC Discovery §4.3） */
  readonly issuer: string;
  /** jwks_uri（无尾斜杠） */
  readonly jwksUri: string;
}

/** 去掉尾斜杠：所有公开 URL 共用的唯一归一判据 */
function stripTrailingSlashes(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * 公开 URL 推导 —— **纯函数，唯一实现**。
 *
 * ## 为什么要有它（2026-10-13，架构评审 R2 次级候选「公开 URL 推导」）
 *
 * 同一段推导原先在三个 getter 里各写一遍，且**判据不一致**：
 * `NEXT_PUBLIC_APP_URL` 走 `.trim().replace(/\/+$/, '')`，而 `PORTAL_ISSUER` /
 * `PORTAL_JWKS_URI` 只 `.trim()` —— 于是显式配置 `PORTAL_ISSUER=https://sso.example.com/`
 * 会得到**带尾斜杠的 issuer**，而 Discovery 的 `issuer` 按 ADR-012 必须与取 metadata 的
 * URL 同源 ⇒ 严格的 OIDC RP 会以 issuer 不匹配拒绝登录。
 * 该不对称当时被 `apps/portal/src/lib/env.test.ts` **写成了规范**（同一种疾病本仓第三次出现）。
 *
 * ## 为什么接受 env 注入
 *
 * 原先唯一接受注入的入口 `parsePortalEnv` **零消费者**，实际被消费的是读模块级缓存单例的
 * getter ⇒ 推导只能靠「改 `process.env` + `resetConfig()`」来测。纯函数可以直接喂 env，
 * 这就是本候选要的测试面。
 *
 * 三个公开 URL 的判据统一为：**先 trim、再去尾斜杠**；未显式配置时按 ADR-012 的默认推导。
 *
 * @param env env 切片（`getConfig()` 的视图或任何同形对象）
 */
export function resolvePublicUrls(env: PublicUrlEnv): PublicUrls {
  const appBaseURL = stripTrailingSlashes(env.NEXT_PUBLIC_APP_URL);
  const issuer = env.PORTAL_ISSUER
    ? stripTrailingSlashes(env.PORTAL_ISSUER)
    : appBaseURL;
  const jwksUri = env.PORTAL_JWKS_URI
    ? stripTrailingSlashes(env.PORTAL_JWKS_URI)
    : `${appBaseURL}/api/auth/jwks`;
  return { appBaseURL, issuer, jwksUri };
}

export function getDatabaseUrl(): string {
  // DATABASE_URL 唯一的 strict 校验点：缺失即 fail-fast（运行时缓存视图已放宽为可选）
  return databaseEnvSchema.parse(process.env).DATABASE_URL;
}

export function getLogLevel(): z.infer<typeof logLevelSchema> {
  return logLevelSchema.parse(process.env['LOG_LEVEL']);
}

export function isCookieSecure(env?: Partial<PortalEnv>): boolean {
  const cfg = env ?? getConfig();
  if (cfg.COOKIE_SECURE === undefined) {
    return cfg.NODE_ENV === 'production';
  }
  return cfg.COOKIE_SECURE === true;
}

export function getAppBaseURL(): string {
  return resolvePublicUrls(getConfig()).appBaseURL;
}

export function getIssuer(): string {
  return resolvePublicUrls(getConfig()).issuer;
}

export function getJwksUri(): string {
  return resolvePublicUrls(getConfig()).jwksUri;
}

export function getTrustedOrigins(): string[] {
  const cfg = getConfig();
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
  return getConfig().REDIS_URL.trim();
}

export function getGatewaySharedSecret(): string | null {
  return getConfig().GATEWAY_SHARED_SECRET || null;
}
