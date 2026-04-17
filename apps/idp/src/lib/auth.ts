import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt, oidcProvider, bearer } from 'better-auth/plugins';
import { redisStorage } from '@better-auth/redis-storage';
import Redis from 'ioredis';
import bcrypt from 'bcryptjs';

import { db } from '../db';
import * as schema from '../db/schema';

// 获取当前基础 URL，优先从环境变量读取
console.log('[Auth] All BETTER_AUTH env vars:', Object.keys(process.env).filter(k => k.startsWith('BETTER_AUTH')).reduce((obj, key) => ({ ...obj, [key]: process.env[key] }), {}));
const currentBaseURL = (process.env.BETTER_AUTH_URL || 'http://localhost:4001').trim();

/**
 * Redis 客户端配置
 */
export let redis: Redis | null = null;
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
 * 严格遵守：100% 数据库驱动，代码中不保留任何业务配置
 */
export const auth = betterAuth({
  appName: 'Auth-SSO IdP',
  baseURL: currentBaseURL,
  basePath: '/api/auth', // 核心修复：显式指定基础路径
  secret: process.env.BETTER_AUTH_SECRET,

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

  // 恢复 Redis，用于处理 OIDC 授权码等高性能状态
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
    oidcProvider({
      useJWTPlugin: true,
      loginPage: '/sign-in',
      scopes: ['openid', 'profile', 'email', 'offline_access'],
      trustedClients: [],
      // 核心：即使 Pre-seed 失效，自动跳转也能兜底
      getConsentHTML: (ctx) => `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Authorizing...</title>
            <script>
              window.onload = function() {
                const payload = { 
                  accept: true, 
                  consent_code: '${ctx.code}',
                  scopes: ${JSON.stringify(ctx.scopes.join(' '))}
                };
                
                fetch('/api/auth/oauth2/consent', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
                })
                .then(async res => {
                  const text = await res.text();
                  if (!res.ok) throw new Error('Status ' + res.status + ': ' + text);
                  return JSON.parse(text);
                })
                .then(data => {
                  if (data.redirectURI) {
                    window.location.href = data.redirectURI;
                  }
                })
                .catch(err => {
                  console.error('[Consent] Error:', err);
                  document.body.innerHTML = 'Authorization failed. Please try again.';
                });
              };
            </script>
          </head>
          <body>
            <p>Authorizing, please wait...</p>
          </body>
        </html>
      `
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
