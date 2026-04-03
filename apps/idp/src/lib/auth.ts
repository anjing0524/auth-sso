import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt, oidcProvider } from 'better-auth/plugins';
import bcrypt from 'bcryptjs';

import { db } from '../db';
import * as schema from '../db/schema';

/**
 * Auth-SSO IdP 核心配置 - 架构整洁版
 * 
 * 完全对齐 Drizzle Schema 与 Better-Auth OIDC 插件期望的数据结构，
 * 抛弃所有“中间件转换”与“强行映射”，回归架构设计的最初本源。
 */
export const auth = betterAuth({
  appName: 'Auth-SSO IdP',
  baseURL: (process.env.BETTER_AUTH_URL || 'https://auth-sso-idp.vercel.app').replace(/\/$/, ''),
  secret: process.env.BETTER_AUTH_SECRET || 'your-better-auth-secret-min-32-chars-long',

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      ...schema,
      // 核心表映射
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      
      // OIDC 插件表映射（表内的属性名现已通过 Schema 修正完全匹配 Better-Auth 默认预期）
      oauthApplication: schema.clients,
      oauthAccessToken: schema.oauthAccessTokens,
      oauthConsent: schema.oauthConsent,
      jwks: schema.jwks,
    },
  }),

  // 必须禁用 /token 路径以符合 OIDC 插件合规性
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
          redirectUrls: ['https://auth-sso-portal.vercel.app/api/auth/callback', 'http://localhost:4000/api/auth/callback'],
          skipConsent: true,
          disabled: false,
          metadata: {},
        },
        {
          clientId: 'demo-app',
          clientSecret: process.env.DEMO_APP_CLIENT_SECRET,
          name: 'Demo App',
          type: 'web',
          redirectUrls: ['https://auth-sso-demo-tau.vercel.app/auth/callback', 'http://localhost:4002/auth/callback'],
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
