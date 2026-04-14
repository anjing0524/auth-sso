import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/db/schema';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';

async function seed() {
  console.log('🌱 Seeding production database...');
  const connectionString = process.env.DATABASE_URL;
  const client = postgres(connectionString!, { ssl: 'require' });
  const db = drizzle(client, { schema });

  try {
    // 1. 创建管理员
    const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || 'v8Z-k9X_m2Q!p5W@';
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    const adminId = nanoid();

    await db.insert(schema.users).values({
      id: adminId,
      publicId: `usr_${nanoid(12)}`,
      username: 'admin',
      email: 'admin@example.com',
      name: '系统管理员',
      status: 'ACTIVE',
    });

    await db.insert(schema.accounts).values({
      id: nanoid(),
      userId: adminId,
      accountId: 'admin',
      providerId: 'credential',
      password: hashedPassword,
    });
    console.log('✅ Admin user created.');

    // 2. 创建 Portal 客户端
    await db.insert(schema.clients).values({
      id: nanoid(),
      publicId: `cli_${nanoid(12)}`,
      name: 'Auth-SSO Portal',
      clientId: 'portal',
      clientSecret: process.env.PORTAL_CLIENT_SECRET,
      redirectUrls: 'https://auth-sso-portal.vercel.app/api/auth/callback,http://localhost:4000/api/auth/callback',
      skipConsent: true, // 核心需求
      status: 'ACTIVE',
    });
    console.log('✅ Portal client created.');

    // 3. 创建 Demo App 客户端
    await db.insert(schema.clients).values({
      id: nanoid(),
      publicId: `cli_${nanoid(12)}`,
      name: 'Demo Application',
      clientId: 'demo-app',
      clientSecret: process.env.DEMO_APP_CLIENT_SECRET,
      redirectUrls: 'https://auth-sso-demo-tau.vercel.app/auth/callback,http://localhost:4002/auth/callback',
      skipConsent: true,
      status: 'ACTIVE',
    });
    console.log('✅ Demo App client created.');

    console.log('✨ Seed complete!');
  } finally {
    await client.end();
  }
}

seed().catch(console.error);
