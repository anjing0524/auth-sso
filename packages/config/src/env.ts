/**
 * Auth-SSO 共享环境变量配置与 URL 推导模块 (Shared Env Config & URL Derivation)
 *
 * 职责：
 * 1. Zod Schema — 生产环境启动时 fail-fast 校验
 * 2. URL 推导函数 — 运行时懒解析，带 dev 默认值，消除各处 localhost 硬编码
 *
 * 架构说明：IDP 已合并进 Portal，所有认证功能由 Portal 统一管理。
 * Portal 自身即是 OIDC Provider（纯自定义 JWT 实现，基于 jose 库，密钥对存 DB）。
 *
 * @module @auth-sso/config/env
 */

import { z } from 'zod';

// ============================================================================
// 常量：唯一默认值出口
// ============================================================================

/** Portal 本地开发默认端口（与 gateway 对齐） */
const DEV_DEFAULT_PORT = '4100';
const DEV_DEFAULT_BASE_URL = `http://localhost:${DEV_DEFAULT_PORT}`;

// ============================================================================
// 第一层：Zod Schema（启动时校验）
// ============================================================================

const baseEnvSchema = z.object({
  // 运行环境
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // 数据库配置
  DATABASE_URL: z.string().url(),

  // Redis 配置
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  // 日志级别
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const portalEnvSchema = baseEnvSchema.extend({
  // 应用基础 URL
  NEXT_PUBLIC_APP_NAME: z.string().default('Auth-SSO Portal'),
  NEXT_PUBLIC_APP_URL: z.string().url().default(DEV_DEFAULT_BASE_URL),

  // OAuth 客户端凭证（Portal 自身作为 OIDC Provider 的内置客户端）
  PORTAL_CLIENT_SECRET: z.string().optional(),

  // Gateway 信任路径 HMAC 共享密钥。Gateway 在上游转发时对 (timestamp + userId + jti)
  // 计算 HMAC-SHA256 签名并注入 X-Gateway-Signature / X-Gateway-Timestamp 头，
  // Portal 验证此签名以确认请求确实来自受信任的 Gateway（取代不可靠的 IP 白名单）。
  // 生产环境必须配置；未配置时跳过 HMAC 校验并输出警告（兼容本地开发）。
  GATEWAY_SHARED_SECRET: z.string().optional(),
});

/** Zod 解析后的环境变量类型 */
export type PortalEnv = z.infer<typeof portalEnvSchema>;

/**
 * 解析并验证 Portal 环境变量（推荐在应用启动时调用一次）
 * @throws ZodError 校验失败
 */
export function parsePortalEnv(env: Record<string, string | undefined>): PortalEnv {
  return portalEnvSchema.parse(env);
}

/** 便捷：从 process.env 解析 */
export function getEnvConfig(): PortalEnv {
  return parsePortalEnv(process.env as Record<string, string | undefined>);
}

/** 安全解析（不抛异常） */
export function safeGetEnv(
  env: Record<string, string | undefined>
): { success: true; data: PortalEnv } | { success: false; error: EnvValidationError } {
  try {
    const data = portalEnvSchema.parse(env);
    return { success: true, data };
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return { success: false, error: new EnvValidationError(err.issues) };
    }
    throw err;
  }
}

/** 环境变量验证错误 */
export class EnvValidationError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    const message = `Invalid environment variables for Portal:\n${issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n')}`;
    super(message);
    this.name = 'EnvValidationError';
  }
}

// ============================================================================
// 第二层：URL 推导函数（运行时懒解析，供各服务端模块直接使用）
// ============================================================================

/** 内部：带类型的安全 env 访问（规避 noPropertyAccessFromIndexSignature 规则） */
const e = process.env as Record<string, string | undefined>;

/**
 * Portal 对外访问根地址
 *
 * 优先级：BETTER_AUTH_URL > NEXT_PUBLIC_APP_URL > 默认值
 * 返回值已去除尾部斜杠，可直接用于 new URL(path, base) 拼接
 */
export function getAppBaseURL(): string {
  return (
    e['BETTER_AUTH_URL'] ||
    e['NEXT_PUBLIC_APP_URL'] ||
    DEV_DEFAULT_BASE_URL
  ).trim().replace(/\/+$/, '');
}

/**
 * OIDC Provider Issuer 标识
 *
 * 优先级：PORTAL_ISSUER > getAppBaseURL()
 */
export function getIssuer(): string {
  return (e['PORTAL_ISSUER'] || getAppBaseURL()).trim();
}

/**
 * JWKS 端点完整 URL
 *
 * 优先级：PORTAL_JWKS_URI > 拼接 {baseURL}/api/auth/jwks
 */
export function getJwksUri(): string {
  return (
    e['PORTAL_JWKS_URI'] ||
    `${getAppBaseURL()}/api/auth/jwks`
  ).trim();
}

/**
 * CORS / Better Auth 受信任来源域列表
 *
 * 优先级：TRUSTED_ORIGINS env（逗号分隔）> 本地开发默认值
 *
 * 生产环境必须通过 TRUSTED_ORIGINS 显式配置，
 * 本地开发自动覆盖 localhost:4000/4100（含 127.0.0.1 变体）
 */
export function getTrustedOrigins(): string[] {
  if (e['TRUSTED_ORIGINS']) {
    return e['TRUSTED_ORIGINS']!.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const origins = new Set<string>([getAppBaseURL()]);

  if (e['NODE_ENV'] !== 'production') {
    ['4000', '4100'].forEach((port) => {
      origins.add(`http://localhost:${port}`);
      origins.add(`http://127.0.0.1:${port}`);
    });
  }

  return Array.from(origins);
}

/**
 * Redis 连接 URL
 */
export function getRedisUrl(): string {
  return (e['REDIS_URL'] || 'redis://localhost:6379').trim();
}

/**
 * Gateway 信任路径 HMAC 共享密钥。
 *
 * 用于验证上游请求中的 X-Gateway-Signature 头——
 * Gateway 在上游转发时用此密钥对 (timestamp + userId + jti) 计算 HMAC-SHA256，
 * Portal 端重新计算并比对，以确认请求确实来自受信任的 Gateway。
 *
 * 未配置时返回 null——调用方须跳过 HMAC 校验（兼容本地开发）。
 */
export function getGatewaySharedSecret(): string | null {
  return (e['GATEWAY_SHARED_SECRET'] || null);
}
