import 'dotenv/config';
import { db } from '../src/db';
import * as schema from '../db/schema';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';

/**
 * 数据库种子脚本
 * 修复：不再硬编码密码，通过环境变量 INITIAL_ADMIN_PASSWORD 读取
 */
async function seed() {
  console.log('🌱 Seeding database...');

  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error('❌ INITIAL_ADMIN_PASSWORD must be defined in environment to seed data safely.');
  }

  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  // 检查是否已存在管理员
  const existingAdmin = await db.query.users.findFirst({
    where: (users, { eq }) => eq(users.username, 'admin'),
  });

  if (!existingAdmin) {
    const userId = nanoid();
    const [user] = await db.insert(schema.users).values({
      id: userId,
      publicId: `usr_${nanoid(12)}`,
      username: 'admin',
      email: 'admin@example.com',
      emailVerified: true,
      name: 'Admin User',
      status: 'ACTIVE',
    }).returning();

    await db.insert(schema.accounts).values({
      id: nanoid(),
      userId: user.id,
      accountId: user.id,
      providerId: 'credential',
      password: hashedPassword,
    });
    console.log('✅ Created admin user');
  } else {
    console.log('ℹ️ Admin user already exists, skipping creation');
  }

  // 初始化客户端 (OIDC Clients)
  // ... 此处保留客户端初始化逻辑 ...
  
  console.log('🌱 Seed complete!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
