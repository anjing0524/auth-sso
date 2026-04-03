import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt, oidcProvider } from 'better-auth/plugins';
import { redisStorage } from '@better-auth/redis-storage';
import bcrypt from 'bcryptjs';

import { db } from '../db';
import * as schema from '../db/schema';
import { getRedis } from './redis';

/**
 * Auth-SSO IdP 核心配置 - 生产正式版
 * 
 * 变更记录:
 * 1. 恢复 Redis 二级存储：作为 Session 缓存提升性能，但移除自定义前缀冲突。
 * 2. 移除 cookiePrefix：确保 Better Auth 及其插件在处理重定向时的 Session 识别一致性。
 * 3. 规范 issuer 配置：确保与 baseURL 一致以符合 OIDC 标准。
 * 4. 增加了对已登录用户的 Session 预检测（在 sign-in/page.tsx 中）。
 */
export const auth = betterAuth({
  appName: 'Auth-SSO IdP',
  // 基础 URL 配置，生产环境必须通过 BETTER_AUTH_URL 覆盖
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:4001',
  secret: process.env.BETTER_AUTH_SECRET || 'your-better-auth-secret-min-32-chars-long',

  // 核心数据库存储 - 保持数据强一致性
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      ...schema,
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      oauthClient: schema.clients,
      oauthAccessToken: schema.oauthAccessTokens,
      oauthRefreshToken: schema.oauthRefreshTokens,
      authorizationCode: schema.authorizationCodes,
      oauthConsent: schema.oauthConsent,
      jwks: schema.jwks,
    },
  }),

  // 恢复 Redis 二级存储：作为缓存层提升 Session 读取性能
  secondaryStorage: redisStorage({
    client: getRedis(),
    keyPrefix: 'idp:',
  }),

  // OIDC 插件合规性配置：必须禁用 /token 路径
  disabledPaths: ['/token'],

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    password: {
      hash: async (password: string) => await bcrypt.hash(password, 10),
      verify: async ({ hash, password }: { hash: string; password: string }) => await bcrypt.compare(password, hash),
    },
  },

  plugins: [
    jwt({
      jwt: {
        issuer: process.env.BETTER_AUTH_URL || 'http://localhost:4001',
        audience: 'auth-sso-users',
        expirationTime: '1h',
      },
    }),
    oidcProvider({
      useJWTPlugin: true,
      loginPage: '/sign-in',
      scopes: ['openid', 'profile', 'email', 'offline_access'],
      trustedClients: [
        {
          clientId: 'portal',
          clientSecret: process.env.PORTAL_CLIENT_SECRET || 'portal-secret',
          name: 'Portal',
          type: 'web',
          redirectUrls: [
            process.env.PORTAL_REDIRECT_URL,
            'http://localhost:4000/api/auth/callback',
          ].filter((url): url is string => !!url),
          skipConsent: true,
        },
        {
          clientId: 'demo-app',
          clientSecret: process.env.DEMO_APP_CLIENT_SECRET || 'demo-app-secret',
          name: 'Demo App',
          type: 'web',
          redirectUrls: [
            process.env.DEMO_APP_REDIRECT_URL,
            'http://localhost:4002/auth/callback',
          ].filter((url): url is string => !!url),
          skipConsent: true,
        },
      ],
    }),
  ],

  user: {
    modelName: 'users',
    additionalFields: {
      publicId: { type: 'string', required: true, unique: true },
    },
  },

  advanced: {
    // 生产环境强制使用安全 Cookie
    useSecureCookies: process.env.NODE_ENV === 'production',
  },
});

export type Auth = typeof auth;
