import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt, oidcProvider } from 'better-auth/plugins';
import { redisStorage } from '@better-auth/redis-storage';
import Redis from 'ioredis';
import bcrypt from 'bcryptjs';

import { db } from '../db';
import * as schema from '../db/schema';

// 固定生产环境 URL
const currentBaseURL = 'https://auth-sso-idp.vercel.app';

/**
 * Redis 客户端配置 (极致稳定性)
 */
let redis: Redis | null = null;
try {
  if (process.env.REDIS_URL) {
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 0,
      connectTimeout: 5000,
      lazyConnect: true,
    });
  }
} catch (e) {
  console.error('[Auth] Failed to initialize Redis client:', e);
}

/**
 * Auth-SSO IdP 核心配置
 * 回归数据库驱动，通过 Drizzle Schema 建立映射，消除代码冗余。
 */
export const auth = betterAuth({
  appName: 'Auth-SSO IdP',
  baseURL: currentBaseURL,
  secret: process.env.BETTER_AUTH_SECRET,

  // 100% 信任 Redis 处理动态状态（Session/Token）
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
      // 核心 OIDC 映射：Schema 已内置 skipConsent -> skip_consent 等映射
      oauthApplication: schema.clients,
      oauthAccessToken: schema.oauthAccessTokens,
      oauthRefreshToken: schema.oauthRefreshTokens,
      oauthAuthorizationCode: schema.authorizationCodes,
      oauthConsent: schema.oauthConsent,
      jwks: schema.jwks,
    },
  }),

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
        issuer: currentBaseURL,
        expirationTime: '1h',
      },
    }),
    oidcProvider({
      useJWTPlugin: true,
      loginPage: '/sign-in',
      scopes: ['openid', 'profile', 'email', 'offline_access'],
      // 100% 数据库驱动，移除静态 trustedClients。
      // 插件现在能通过 schema.clients.skipConsent 映射自动发现数据库中的 true 值。
      trustedClients: [],
    }),
  ],

  user: {
    modelName: 'users',
  },

  advanced: {
    useSecureCookies: process.env.NODE_ENV === 'production',
  },
});

export type Auth = typeof auth;
