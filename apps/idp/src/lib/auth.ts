import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt, oidcProvider } from 'better-auth/plugins';
import bcrypt from 'bcryptjs';

import { db } from '../db';
import * as schema from '../db/schema';
import * as pluginSchema from '../db/auth-plugin-schema';

/**
 * Auth-SSO IdP 核心配置 - 终极解耦版
 * 
 * 核心修复说明:
 * 1. 彻底解决 500 报错：抛弃有 Bug 的字段映射（{ table, fields }），直接使用原生的中间 Schema (`auth-plugin-schema.ts`)。这使得 Better-Auth 读取时是其预期的字段名，而写入数据库时是正确的真实列名。
 * 2. 数据层完美对齐：确保 OAuth 流程中产生的数据准确存入 PostgreSQL 对应列。
 */
export const auth = betterAuth({
  appName: 'Auth-SSO IdP',
  baseURL: (process.env.BETTER_AUTH_URL || 'https://auth-sso-idp.vercel.app').replace(/\/$/, ''),
  secret: process.env.BETTER_AUTH_SECRET || 'your-better-auth-secret-min-32-chars-long',

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      ...schema,
      // Core tables
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      
      // Plugin tables - 使用中间 Schema 确保字段名 100% 吻合 Better-Auth 预期
      oauthApplication: pluginSchema.oauthApplication,
      oauthAccessToken: pluginSchema.oauthAccessToken,
      oauthConsent: pluginSchema.oauthConsent,
      jwks: pluginSchema.jwks,
      
      // 注意：Better Auth v1.5 OIDC 插件不默认使用 authorizationCode 数据库表，
      // 若出现问题，我们仍然保留 Drizzle 映射
      authorizationCode: schema.authorizationCodes,
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
