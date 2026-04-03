import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt, oidcProvider } from 'better-auth/plugins';
import bcrypt from 'bcryptjs';

import { db } from '../db';
import * as schema from '../db/schema';

/**
 * Auth-SSO IdP 核心配置 - 工业级 JWT 修复版
 * 
 * 核心修复说明:
 * 1. 显式 JWKS 映射：手动映射 publicKey/privateKey 字段名，解决开启 useJWTPlugin 后因数据库字段名不匹配导致的 500 崩溃。
 * 2. 恢复 JWT 签名：坚持使用 JWT 非对称签名，确保 OIDC 协议的完整性和安全性。
 * 3. 增强诊断：确保所有的 OAuth 映射均已手动对齐，彻底消除 Drizzle 自动推断的隐患。
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
      // 1. OAuth 客户端表映射
      oauthClient: {
        table: schema.clients,
        fields: {
          clientId: 'clientId',
          clientSecret: 'clientSecret',
          redirectUrls: 'redirectUris',
        }
      },
      // 2. Access Token 表映射 (解决 500 核心)
      oauthAccessToken: {
        table: schema.oauthAccessTokens,
        fields: {
          accessToken: 'accessToken',
          expiresAt: 'accessTokenExpiresAt',
          clientId: 'clientId',
          userId: 'userId',
        }
      },
      // 3. Refresh Token 表映射
      oauthRefreshToken: {
        table: schema.oauthRefreshTokens,
        fields: {
          refreshToken: 'refreshToken',
          expiresAt: 'refreshTokenExpiresAt',
          clientId: 'clientId',
          userId: 'userId',
        }
      },
      // 4. 授权码表映射
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
      // 5. JWKS 表显式映射 (解决 useJWTPlugin 500 核心)
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
        // 移除固定的 audience，让 OIDC 插件动态填充 client_id
        expirationTime: '1h',
      },
    }),
    oidcProvider({
      // 核心要求：必须启用 JWT 插件集成
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
