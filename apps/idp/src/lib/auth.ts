import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt, oidcProvider } from 'better-auth/plugins';
import bcrypt from 'bcryptjs';

import { db } from '../db';
import * as schema from '../db/schema';

/**
 * Auth-SSO IdP 核心配置 - 架构加固版
 * 
 * 核心修复说明:
 * 1. 禁用 Better-Auth 内部 Redis 存储：解决 OIDC 插件与 Redis 二级存储不兼容导致的 500 崩溃。
 * 2. 穷举式字段映射：显式映射所有 OAuth 相关的数据库字段，防止 Drizzle 在 Token 交换时产生非法 SQL。
 * 3. 强化数据一致性：确保 Token、Scopes、ExpiresAt 等关键字段在数据库中精准落地。
 */
export const auth = betterAuth({
  appName: 'Auth-SSO IdP',
  // 生产环境 URL 必须保持整洁
  baseURL: (process.env.BETTER_AUTH_URL || 'https://auth-sso-idp.vercel.app').replace(/\/$/, ''),
  secret: process.env.BETTER_AUTH_SECRET || 'your-better-auth-secret-min-32-chars-long',

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      ...schema,
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      // 1. OAuth 客户端表穷举映射
      oauthClient: {
        table: schema.clients,
        fields: {
          clientId: 'clientId',
          clientSecret: 'clientSecret',
          redirectUrls: 'redirectUris',
          disabled: 'disabled',
          name: 'name',
        }
      },
      // 2. Access Token 表穷举映射 (彻底解决 500)
      oauthAccessToken: {
        table: schema.oauthAccessTokens,
        fields: {
          accessToken: 'accessToken',
          expiresAt: 'accessTokenExpiresAt',
          clientId: 'clientId',
          userId: 'userId',
          scopes: 'scopes', // 显式映射复数 scopes
        }
      },
      // 3. Refresh Token 表穷举映射
      oauthRefreshToken: {
        table: schema.oauthRefreshTokens,
        fields: {
          refreshToken: 'refreshToken',
          expiresAt: 'refreshTokenExpiresAt',
          clientId: 'clientId',
          userId: 'userId',
          scopes: 'scopes',
        }
      },
      // 4. 授权码表穷举映射
      authorizationCode: {
        table: schema.authorizationCodes,
        fields: {
          code: 'code',
          expiresAt: 'expiresAt',
          redirectUri: 'redirectUri',
          clientId: 'clientId',
          userId: 'userId',
          scope: 'scope', // 授权码表中使用单数 scope
        }
      },
      // 5. JWKS 表映射
      jwks: {
        table: schema.jwks,
        fields: {
          publicKey: 'publicKey',
          privateKey: 'privateKey',
          createdAt: 'createdAt',
        }
      },
    },
  }),

  // 关键：暂时禁用 Better-Auth 内置的 Redis 存储，直到 SSO 链路完全稳定
  // secondaryStorage: redisStorage({ ... }), 

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
        issuer: (process.env.BETTER_AUTH_URL || 'https://auth-sso-idp.vercel.app').replace(/\/$/, ''),
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
          redirectUrls: ['https://auth-sso-portal.vercel.app/api/auth/callback'],
          skipConsent: true,
          disabled: false,
          metadata: {},
        },
        {
          clientId: 'demo-app',
          clientSecret: process.env.DEMO_APP_CLIENT_SECRET,
          name: 'Demo App',
          type: 'web',
          redirectUrls: ['https://auth-sso-demo-tau.vercel.app/auth/callback'],
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
