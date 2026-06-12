/**
 * Auth-SSO 环境变量配置
 * @module @auth-sso/config/env
 *
 * 架构说明：IDP 已合并进 Portal，所有认证功能由 Portal 统一管理。
 * Portal 自身即是 OIDC Provider（Better Auth + oauthProvider 插件），
 * Demo App 等第三方应用直接对接 Portal 进行 OAuth/OIDC 认证。
 */

import { z } from 'zod';

/**
 * 基础环境变量 Schema
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
 * Portal 环境变量 Schema（含 OIDC Provider 配置）
 */
const portalEnvSchema = baseEnvSchema.extend({
  // Portal 应用配置
  NEXT_PUBLIC_APP_NAME: z.string().default('Auth-SSO Portal'),
  NEXT_PUBLIC_APP_URL: z.string().url(),

  // Better Auth 配置（Portal 自身即是 OIDC Provider）
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),

  // 用于 demo-app 等客户端接入的 OAuth Client 凭证（由 Portal 的 OIDC Provider 签发）
  PORTAL_CLIENT_ID: z.string().optional(),
  PORTAL_CLIENT_SECRET: z.string().optional(),

  // Session 配置
  SESSION_MAX_AGE_SEC: z.coerce.number().default(604800), // 7 days
  SESSION_IDLE_TIMEOUT_SEC: z.coerce.number().default(86400), // 1 day
});

/**
 * 环境变量解析结果类型
 */
export type PortalEnv = z.infer<typeof portalEnvSchema>;

/**
 * 解析并验证 Portal 环境变量
 */
export function parsePortalEnv(env: Record<string, string | undefined>): PortalEnv {
  return portalEnvSchema.parse(env);
}

/**
 * 获取 Portal 环境配置
 */
export function getEnvConfig(): PortalEnv {
  return parsePortalEnv(process.env as Record<string, string | undefined>);
}

/**
 * 环境变量验证错误
 */
export class EnvValidationError extends Error {
  constructor(
    public readonly issues: z.ZodIssue[]
  ) {
    const message = `Invalid environment variables for Portal:\n${issues
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