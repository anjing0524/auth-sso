import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt, bearer } from 'better-auth/plugins';
import { oauthProvider } from '@better-auth/oauth-provider';
import { redisStorage } from '@better-auth/redis-storage';
import bcrypt from 'bcryptjs';

import { db, schema } from '@/infrastructure/db';
import { getRawIoredisClient } from '@/infrastructure/redis';

const currentBaseURL = (
  process.env.BETTER_AUTH_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'http://localhost:4000'
).trim();

/** Redis 客户端实例：直接复用单例物理连接 */
export const redis = getRawIoredisClient();

/**
 * Auth-SSO 统一身份中心核心配置
 * Portal 自身即是 OIDC Provider，集成 Better Auth + oauthProvider 插件
 */
export const auth = betterAuth({
  appName: 'Auth-SSO Portal',
  baseURL: currentBaseURL,
  basePath: '/api/auth',
  secret: process.env.BETTER_AUTH_SECRET,

  rateLimit: {
    enabled: process.env.DISABLE_RATE_LIMIT === 'true' ? false : true,
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 60, max: 3 },
      '/oauth2/authorize': { window: 60, max: 30 },
      '/oauth2/token': { window: 60, max: 20 },
    },
  },

  advanced: {
    useSecureCookies: process.env.NODE_ENV === 'production',
    crossOrigin: true,
  },
  trustedOrigins: [
    'https://auth-sso-portal.vercel.app',
    'https://auth-sso-demo-tau.vercel.app',
    'http://localhost:4000', 'http://localhost:4002',
    'http://localhost:4100', 'http://localhost:4102',
    'http://127.0.0.1:4100', 'http://127.0.0.1:4102',
  ],

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
    jwt({ jwt: { issuer: currentBaseURL, expirationTime: '1h' } }),
    oauthProvider({
      loginPage: '/login',
      consentPage: '/oauth/consent',
      silenceWarnings: { oauthAuthServerConfig: true, openidConfig: true },
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
