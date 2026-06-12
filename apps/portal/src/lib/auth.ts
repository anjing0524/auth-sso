import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt, bearer } from 'better-auth/plugins';
import { oauthProvider } from '@better-auth/oauth-provider';
import { redisStorage } from '@better-auth/redis-storage';
import bcrypt from 'bcryptjs';

import { db, schema } from './db';
import { getRawIoredisClient } from './redis';

const currentBaseURL = (
  process.env.BETTER_AUTH_URL || 
  process.env.NEXT_PUBLIC_APP_URL || 
  'http://localhost:4000'
).trim();

/**
 * Redis 客户端配置：直接复用单例物理连接，杜绝多余 TCP 连接闲置
 */
export const redis = getRawIoredisClient();

/**
 * Auth-SSO 统一身份中心 (Portal 托管版 IDP) 核心配置
 * 100% 数据库驱动，与 Portal 共享同一个数据源
 */
export const auth = betterAuth({
  appName: 'Auth-SSO Portal IDP',
  baseURL: currentBaseURL,
  basePath: '/api/auth', // 显式指定基础路径为 /api/auth
  secret: process.env.BETTER_AUTH_SECRET,

  rateLimit: {
    // 支持通过环境变量 DISABLE_RATE_LIMIT 快速开关速率限制，防止日常调试或集成压测时频繁触发 429 阻断
    enabled: process.env.DISABLE_RATE_LIMIT === 'true' ? false : true,
    window: 60, // 60s
    max: 100,
    customRules: {
      "/sign-in/email": {
        window: 60,
        max: 5,
      },
      "/sign-up/email": {
        window: 60,
        max: 3,
      },
      "/oauth2/authorize": {
        window: 60,
        max: 30,
      },
      "/oauth2/token": {
        window: 60,
        max: 20,
      },
    },
  },

  advanced: {
    useSecureCookies: process.env.NODE_ENV === 'production',
    crossOrigin: true,
  },
  trustedOrigins: [
    'https://auth-sso-portal.vercel.app',
    'https://auth-sso-idp.vercel.app',
    'https://auth-sso-demo-tau.vercel.app',
    'http://localhost:4000',
    'http://localhost:4001',
    'http://localhost:4002',
    'http://localhost:4100',
    'http://localhost:4101',
    'http://localhost:4102',
    'http://127.0.0.1:4100',
    'http://127.0.0.1:4101',
    'http://127.0.0.1:4102',
  ],

  // 复用 Redis，用于处理 OIDC 授权码等高性能状态
  ...(redis ? {
    secondaryStorage: redisStorage({
      client: redis,
      keyPrefix: 'auth-sso:',
    }),
  } : {}),

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      ...schema,
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      oauthApplication: schema.clients,
      oauthAccessToken: schema.oauthAccessTokens,
      oauthRefreshToken: schema.oauthRefreshTokens,
      oauthAuthorizationCode: schema.authorizationCodes,
      oauthConsent: schema.oauthConsent,
      jwks: schema.jwks,
    },
  }),

  session: {
    storeSessionInDatabase: true,
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    password: {
      hash: async (password: string) => await bcrypt.hash(password, 10),
      verify: async ({ hash, password }: { hash: string; password: string }) => await bcrypt.compare(password, hash),
    },
  },

  plugins: [
    bearer(),
    jwt({
      jwt: {
        issuer: currentBaseURL,
        expirationTime: '1h',
      },
    }),
    oauthProvider({
      loginPage: '/login',
      consentPage: '/oauth/consent',
      silenceWarnings: {
        oauthAuthServerConfig: true,
        openidConfig: true,
      },
    }),
  ],

  user: {
    modelName: 'users',
    additionalFields: {
      publicId: { type: 'string', required: true, unique: true },
    },
  },
});

export type Auth = typeof auth;
