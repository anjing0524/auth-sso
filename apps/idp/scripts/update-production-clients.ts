import 'dotenv/config';
import { db } from '../src/db';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

/**
 * 生产环境数据库更新脚本
 * 修复：不再硬编码密码，通过环境变量 INITIAL_ADMIN_PASSWORD 读取
 */
async function update() {
  console.log('🚀 Updating production data in database...');

  // 从环境变量读取密码，避免泄露
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;
  
  if (!adminPassword) {
    console.warn('⚠️ INITIAL_ADMIN_PASSWORD is not defined. Skipping password update for security.');
  } else {
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    const adminUser = await db.query.users.findFirst({
      where: eq(schema.users.username, 'admin')
    });

    if (adminUser) {
      await db.update(schema.accounts)
        .set({ password: hashedPassword })
        .where(eq(schema.accounts.userId, adminUser.id));
      console.log('✅ Updated admin user password securely');
    }
  }

  // 更新 Portal Client
  const portalRedirectUris = [
    'https://auth-sso-portal.vercel.app/api/auth/callback',
    'http://localhost:4000/api/auth/callback'
  ];
  
  // 获取最新的强随机密钥（从环境变量读取）
  const portalSecret = process.env.PORTAL_CLIENT_SECRET;
  if (!portalSecret) {
    console.warn('⚠️ PORTAL_CLIENT_SECRET is not defined. Skipping portal secret update.');
  }

  await db.update(schema.clients)
    .set({
      redirectUrls: JSON.stringify(portalRedirectUris),
      homepageUrl: 'https://auth-sso-portal.vercel.app',
      ...(portalSecret ? { clientSecret: portalSecret } : {})
    })
    .where(eq(schema.clients.clientId, 'portal'));

  console.log('✅ Updated portal client redirect URIs');

  // 更新 Demo App Client
  const demoRedirectUris = [
    'https://auth-sso-demo-tau.vercel.app/auth/callback',
    'http://localhost:4002/auth/callback'
  ];
  
  await db.update(schema.clients)
    .set({
      redirectUrls: JSON.stringify(demoRedirectUris),
      homepageUrl: 'https://auth-sso-demo-tau.vercel.app'
    })
    .where(eq(schema.clients.clientId, 'demo-app'));

  console.log('✅ Updated demo-app client redirect URIs');
  console.log('✨ Update complete!');
  process.exit(0);
}

update().catch((err) => {
  console.error('❌ Update failed:', err);
  process.exit(1);
});
