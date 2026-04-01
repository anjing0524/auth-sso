/**
 * Better Auth 配置
 * 提供 OIDC Provider 能力，支持 OAuth 2.1 Authorization Code Flow with PKCE
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt } from 'better-auth/plugins';
import { oidcProvider } from 'better-auth/plugins';
import { redisStorage } from '@better-auth/redis-storage';
import bcrypt from 'bcryptjs';

import { db } from '../db';
import * as schema from '../db/schema';
import { getRedis } from './redis';

/**
 * Better Auth 实例配置
 *
 * 功能：
 * - OAuth 2.1 Authorization Code Flow
 * - PKCE (S256 method)
 * - OIDC Provider (openid, profile, email, offline_access scopes)
 * - JWT signing with JWKS endpoint
 * - Redis secondary storage for sessions
 */
export const auth = betterAuth({
  // 应用配置
  appName: 'Auth-SSO IdP',
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:4001',
  secret: process.env.BETTER_AUTH_SECRET || 'your-better-auth-secret-min-32-chars-long',

  // 数据库适配器 - 使用 Drizzle ORM
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      ...schema,
      // 映射 Better Auth 表名到我们的自定义表名
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

  // Redis 二级存储 - 用于 Session 和授权码
  secondaryStorage: redisStorage({
    client: getRedis(),
    keyPrefix: 'idp:',
  }),

  // 邮箱密码认证
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    password: {
      // 使用 bcrypt 进行密码哈希
      hash: async (password: string) => {
        return await bcrypt.hash(password, 10);
      },
      verify: async ({ hash, password }: { hash: string; password: string }) => {
        return await bcrypt.compare(password, hash);
      },
    },
  },

  // 插件配置
  plugins: [
    // JWT 插件 - 提供 JWKS 端点和 ID Token 签名
    jwt({
      jwt: {
        // JWT 配置
        issuer: process.env.JWT_ISSUER || 'auth-sso',
        audience: 'auth-sso-users',
        expirationTime: '1h',
      },
      jwks: {
        // JWKS 端点路径 - 保持默认路径 /api/auth/jwks
        // OIDC Discovery 会自动发现此端点
      },
    }),

    // OIDC Provider 插件 - 提供标准 OIDC 端点
    oidcProvider({
      // 集成 JWT 插件
      useJWTPlugin: true,

      // 登录页面路径
      loginPage: '/sign-in',

      // 授权确认页面路径（可选，用于多 Client 授权）
      consentPage: '/consent',

      // 支持的 OIDC scopes
      scopes: ['openid', 'profile', 'email', 'offline_access'],

      // 用户信息声明配置
      getAdditionalUserInfoClaim: async (user) => {
        return {
          // 可以添加额外的用户信息声明
          user_public_id: user.publicId,
        };
      },

      // 受信任的客户端配置（绕过数据库查找）
      trustedClients: [
        {
          clientId: 'portal',
          clientSecret: process.env.PORTAL_CLIENT_SECRET || 'portal-secret',
          name: 'Portal',
          type: 'web',
          redirectUrls: [
            // 本地开发环境
            'http://localhost:4000/api/auth/callback',
            // 生产环境（通过环境变量配置）
            process.env.PORTAL_REDIRECT_URL || 'https://portal.longlongago.sit/api/auth/callback',
          ].filter(Boolean),
          metadata: {},
          disabled: false,
          skipConsent: true,
        },
        {
          clientId: 'demo-app',
          clientSecret: process.env.DEMO_APP_CLIENT_SECRET || 'demo-app-secret',
          name: 'Demo App',
          type: 'web',
          redirectUrls: [
            // 本地开发环境
            'http://localhost:4002/auth/callback',
            // 生产环境（通过环境变量配置）
            process.env.DEMO_APP_REDIRECT_URL || 'https://demo.longlongago.sit/auth/callback',
          ].filter(Boolean),
          metadata: {},
          disabled: false,
          skipConsent: true,
        },
      ],
    }),
  ],

  // 用户表配置
  user: {
    // 模型名称映射
    modelName: 'users',
    // 用户表中的额外字段映射
    additionalFields: {
      publicId: {
        type: 'string',
        required: true,
        unique: true,
      },
      mobile: {
        type: 'string',
        required: false,
        unique: true,
      },
      mobileVerified: {
        type: 'boolean',
        required: false,
        defaultValue: false,
      },
      avatarUrl: {
        type: 'string',
        required: false,
      },
      status: {
        type: 'string',
        required: true,
        defaultValue: 'ACTIVE',
      },
      deptId: {
        type: 'string',
        required: false,
      },
    },
  },

  // Session 配置
  session: {
    // Session 过期时间（秒）
    expiresIn: parseInt(process.env.SESSION_MAX_AGE_SEC || '604800', 10), // 7 天
    // 更新 Session 的频率
    updateAge: 24 * 60 * 60, // 24 小时
    // Cookie 配置
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 分钟
    },
  },

  // 高级配置
  advanced: {
    // 使用安全 Cookie
    useSecureCookies: process.env.NODE_ENV === 'production',
    // Cookie 前缀
    cookiePrefix: 'idp_',
    // 跨子域 Cookie
    crossSubDomainCookies: {
      enabled: false,
    },
  },
});

/**
 * 导出 Auth 类型
 * 用于客户端类型安全
 */
export type Auth = typeof auth;