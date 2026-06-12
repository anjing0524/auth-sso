/**
 * 生产环境完整初始化脚本
 *
 * 幂等设计：可重复执行，已存在的记录跳过或覆盖。
 * 全部 secret/password 从环境变量读取，无硬编码。
 *
 * 职责：
 *   1. 管理员用户 + Better Auth 账号（upsert）
 *   2. OAuth 客户端（upsert）
 *   3. RBAC 权限/角色初始化（委托 seed-rbac.ts）
 *   4. OAuth Consent 预授权
 *
 * 必要环境变量：
 *   DATABASE_URL                  — 数据库连接串
 *   PORTAL_CLIENT_SECRET          — Portal 客户端密钥
 *   DEMO_APP_CLIENT_SECRET        — Demo App 客户端密钥
 *   INITIAL_ADMIN_PASSWORD        — 管理员初始密码
 *   PORTAL_REDIRECT_URL           — Portal 回调 URL（逗号分隔）
 *   DEMO_APP_REDIRECT_URL         — Demo App 回调 URL（逗号分隔）
 *
 * 运行: cd apps/portal && DATABASE_URL=<url> tsx scripts/seed-production.ts
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// ============================================
// 环境变量校验
// ============================================

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`❌ 缺少必要环境变量: ${name}`);
    process.exit(1);
  }
  return value;
}

// ============================================
// 工具函数
// ============================================

/**
 * 解析逗号分隔的 redirect URL 列表，序列化为 JSON 字符串
 */
function parseRedirectUrls(envValue: string | undefined, fallback: string): string {
  if (envValue) {
    return JSON.stringify(envValue.split(',').map(u => u.trim()));
  }
  return fallback;
}

/**
 * Upsert 用户：存在则跳过，不存在则创建
 */
async function upsertAdmin(db: ReturnType<typeof drizzle>, opts: {
  id: string;
  username: string;
  email: string;
  name: string;
  password: string;
}): Promise<string> {
  const existing = await db.select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, opts.id));

  if (existing.length > 0) {
    console.log(`  ↩ 管理员已存在: ${opts.username}`);
    return opts.id;
  }

  const hashedPassword = await bcrypt.hash(opts.password, 10);

  await db.insert(schema.users).values({
    id: opts.id,
    publicId: `usr_admin_${crypto.randomUUID().slice(0, 8)}`,
    username: opts.username,
    email: opts.email,
    name: opts.name,
    status: 'ACTIVE',
  });

  await db.insert(schema.accounts).values({
    id: crypto.randomUUID(),
    userId: opts.id,
    accountId: opts.email,
    providerId: 'credential',
    password: hashedPassword,
  });

  console.log(`  ✅ 创建管理员: ${opts.username}`);
  return opts.id;
}

/**
 * Upsert OAuth 客户端：按 clientId 查找，存在则更新 redirectUrls，不存在则创建
 */
async function upsertClient(db: ReturnType<typeof drizzle>, opts: {
  clientId: string;
  name: string;
  clientSecret: string;
  redirectUrls: string;
  publicId: string;
  skipConsent?: boolean;
}): Promise<void> {
  const existing = await db.select({ id: schema.clients.id })
    .from(schema.clients)
    .where(eq(schema.clients.clientId, opts.clientId));

  if (existing.length > 0) {
    await db.update(schema.clients)
      .set({
        clientSecret: opts.clientSecret,
        redirectUrls: opts.redirectUrls,
        updatedAt: new Date(),
      })
      .where(eq(schema.clients.clientId, opts.clientId));
    console.log(`  ↩ 客户端已更新: ${opts.name} (${opts.clientId})`);
    return;
  }

  await db.insert(schema.clients).values({
    id: crypto.randomUUID(),
    publicId: opts.publicId,
    name: opts.name,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    redirectUrls: opts.redirectUrls,
    grantTypes: '["authorization_code","refresh_token"]',
    scopes: 'openid profile email offline_access',
    status: 'ACTIVE',
    skipConsent: opts.skipConsent ?? true,
  });
  console.log(`  ✅ 创建客户端: ${opts.name} (${opts.clientId})`);
}

/**
 * 确保 OAuth Consent 预授权记录存在
 */
async function ensureConsent(
  db: ReturnType<typeof drizzle>,
  userId: string,
  clientId: string,
): Promise<void> {
  const existing = await db.select({ id: schema.oauthConsent.id })
    .from(schema.oauthConsent)
    .where(eq(schema.oauthConsent.clientId, clientId));

  if (existing.length > 0) {
    // 更新已有 consent 确保当前用户已授权
    await db.update(schema.oauthConsent)
      .set({ userId, consentGiven: true, updatedAt: new Date() })
      .where(eq(schema.oauthConsent.clientId, clientId));
    return;
  }

  await db.insert(schema.oauthConsent).values({
    id: crypto.randomUUID(),
    userId,
    clientId,
    scopes: 'openid profile email offline_access',
    consentGiven: true,
  });
}

// ============================================
// 主流程
// ============================================

async function main() {
  console.log('🌱 生产环境初始化...');

  // 校验必要环境变量
  const connectionString = requireEnv('DATABASE_URL');
  const portalSecret = requireEnv('PORTAL_CLIENT_SECRET');
  const demoSecret = requireEnv('DEMO_APP_CLIENT_SECRET');
  const adminPassword = requireEnv('INITIAL_ADMIN_PASSWORD');

  // 判断是否需要 SSL（云端数据库）
  const needsSsl = connectionString.includes('sslmode=require')
    || connectionString.includes('.neon.tech')
    || connectionString.includes('.supabase.co');
  const client = postgres(connectionString, needsSsl ? { ssl: 'require' } : {});
  const db = drizzle(client, { schema });

  try {
    // 1. 管理员用户
    console.log('\n👤 初始化管理员...');
    const adminId = await upsertAdmin(db, {
      id: 'usr_admin_fixed_001',
      username: 'admin',
      email: 'admin@example.com',
      name: '系统管理员',
      password: adminPassword,
    });

    // 2. OAuth 客户端
    console.log('\n🔑 初始化客户端...');
    const portalRedirectUrls = parseRedirectUrls(
      process.env.PORTAL_REDIRECT_URL,
      '["http://localhost:4100/auth/callback"]',
    );
    await upsertClient(db, {
      clientId: 'portal',
      name: 'Auth-SSO Portal',
      clientSecret: portalSecret,
      redirectUrls: portalRedirectUrls,
      publicId: 'cli_portal',
      skipConsent: true,
    });

    const demoRedirectUrls = parseRedirectUrls(
      process.env.DEMO_APP_REDIRECT_URL,
      '["http://localhost:4102/auth/callback"]',
    );
    await upsertClient(db, {
      clientId: 'demo-app',
      name: 'Demo SSO App',
      clientSecret: demoSecret,
      redirectUrls: demoRedirectUrls,
      publicId: 'cli_demo',
      skipConsent: true,
    });

    // 3. RBAC 初始化（幂等，从 contracts 读取）
    console.log('\n🛡️  初始化 RBAC...');
    const { main: seedRbac } = await import('./seed-rbac');
    await seedRbac();

    // 4. OAuth Consent 预授权
    console.log('\n✅ 预授权 OAuth Consent...');
    await ensureConsent(db, adminId, 'portal');
    await ensureConsent(db, adminId, 'demo-app');

    console.log('\n✨ 生产环境初始化完成！');
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('\n❌ 初始化失败:', err.message);
  process.exit(1);
});
