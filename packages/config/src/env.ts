/**
 * Auth-SSO 环境变量配置
 * @module @auth-sso/config/env
 */

import { z } from 'zod';

/**
 * 服务环境类型
 */
export type ServiceEnv = 'portal' | 'idp';

/**
 * 基础环境变量 Schema（所有服务共享）
 */
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

/**
 * Portal 环境变量 Schema
 */
const portalEnvSchema = baseEnvSchema.extend({
  // Portal 特有配置
  NEXT_PUBLIC_APP_NAME: z.string().default('Auth-SSO Portal'),
  NEXT_PUBLIC_APP_URL: z.string().url(),

  // IdP 配置（Portal 作为 Client）
  IDP_URL: z.string().url(),
  IDP_CLIENT_ID: z.string(),
  IDP_CLIENT_SECRET: z.string(),

  // Session 配置
  SESSION_SECRET: z.string().min(32),
});

/**
 * IdP 环境变量 Schema
 */
const idpEnvSchema = baseEnvSchema.extend({
  // IdP 特有配置
  NEXT_PUBLIC_APP_NAME: z.string().default('Auth-SSO IdP'),
  NEXT_PUBLIC_APP_URL: z.string().url(),

  // Better Auth 配置
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),

  // JWT 配置
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('auth-sso'),

  // Session 配置
  SESSION_MAX_AGE_SEC: z.coerce.number().default(604800), // 7 days
  SESSION_IDLE_TIMEOUT_SEC: z.coerce.number().default(86400), // 1 day
});

/**
 * 环境变量解析结果类型
 */
export type PortalEnv = z.infer<typeof portalEnvSchema>;
export type IdPEnv = z.infer<typeof idpEnvSchema>;

/**
 * 解析并验证 Portal 环境变量
 */
export function parsePortalEnv(env: Record<string, string | undefined>): PortalEnv {
  return portalEnvSchema.parse(env);
}

/**
 * 解析并验证 IdP 环境变量
 */
export function parseIdPEnv(env: Record<string, string | undefined>): IdPEnv {
  return idpEnvSchema.parse(env);
}

/**
 * 获取服务环境配置
 */
export function getEnvConfig(service: 'portal'): PortalEnv;
export function getEnvConfig(service: 'idp'): IdPEnv;
export function getEnvConfig(service: ServiceEnv): PortalEnv | IdPEnv {
  const env = process.env;

  if (service === 'portal') {
    return parsePortalEnv(env as Record<string, string | undefined>);
  }

  return parseIdPEnv(env as Record<string, string | undefined>);
}

/**
 * 环境变量验证错误
 */
export class EnvValidationError extends Error {
  constructor(
    public readonly service: ServiceEnv,
    public readonly issues: z.ZodIssue[]
  ) {
    const message = `Invalid environment variables for ${service}:\n${issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n')}`;
    super(message);
    this.name = 'EnvValidationError';
  }
}

/**
 * 安全获取环境变量（开发时辅助）
 */
export function safeGetEnv(
  env: Record<string, string | undefined>,
  service: ServiceEnv
): { success: true; data: PortalEnv | IdPEnv } | { success: false; error: EnvValidationError } {
  try {
    const schema = service === 'portal' ? portalEnvSchema : idpEnvSchema;
    const data = schema.parse(env);
    return { success: true, data };
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return { success: false, error: new EnvValidationError(service, err.issues) };
    }
    throw err;
  }
}