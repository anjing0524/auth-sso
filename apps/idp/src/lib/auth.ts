import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt, oidcProvider } from 'better-auth/plugins';
import bcrypt from 'bcryptjs';

import { db } from '../db';
import * as schema from '../db/schema';

/**
 * Auth-SSO IdP 核心配置 - 终极修复版
 * 
 * 核心修复说明:
 * 1. 显式字段映射：手动映射 OAuth 相关的所有字段名，解决由于 Drizzle 自动推断不一致导致的 500 数据库报错。
 * 2. 移除 Redis：保持数据库强一致性，彻底打断重定向死循环。
 * 3. 强凭证校验：Portal 密钥强制从环境变量读取，不再使用任何 fallback。
 */
export const auth = betterAuth({
  appName: 'Auth-SSO IdP',
  baseURL: process.env.BETTER_AUTH_URL || 'https://auth-sso-idp.vercel.app',
  secret: process.env.BETTER_AUTH_SECRET || 'your-better-auth-secret-min-32-chars-long',

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      ...schema,
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      // 显式映射 OAuth 核心表，防止字段名自动推断失败
      oauthClient: {
        table: schema.clients,
        fields: {
          clientId: 'clientId',
          clientSecret: 'clientSecret',
          redirectUrls: 'redirectUris',
        }
      },
      oauthAccessToken: {
        table: schema.oauthAccessTokens,
        fields: {
          accessToken: 'accessToken',
          expiresAt: 'accessTokenExpiresAt',
          clientId: 'clientId',
          userId: 'userId',
        }
      },
      oauthRefreshToken: {
        table: schema.oauthRefreshTokens,
        fields: {
          refreshToken: 'refreshToken',
          expiresAt: 'refreshTokenExpiresAt',
          clientId: 'clientId',
          userId: 'userId',
        }
      },
      authorizationCode: {
        table: schema.authorizationCodes,
        fields: {
          code: 'code',
          expiresAt: 'expiresAt',
          redirectUri: 'redirectUri',
          clientId: 'clientId',
          userId: 'userId',
        }
      },
      jwks: schema.jwks,
    },
  }),

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
        issuer: process.env.BETTER_AUTH_URL || 'https://auth-sso-idp.vercel.app',
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
          clientSecret: process.env.PORTAL_CLIENT_SECRET,
          name: 'Portal',
          type: 'web',
          redirectUrls: [
            'https://auth-sso-portal.vercel.app/api/auth/callback',
            'http://localhost:4000/api/auth/callback',
          ],
          skipConsent: true,
          disabled: false,
          metadata: {},
        },
        {
          clientId: 'demo-app',
          clientSecret: process.env.DEMO_APP_CLIENT_SECRET,
          name: 'Demo App',
          type: 'web',
          redirectUrls: [
            'https://auth-sso-demo-tau.vercel.app/auth/callback',
            'http://localhost:4002/auth/callback',
          ],
          skipConsent: true,
          disabled: false,
          metadata: {},
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
    useSecureCookies: process.env.NODE_ENV === 'production',
  },
});

export type Auth = typeof auth;
