import 'dotenv/config';
import { db } from '../src/db';
import * as schema from '../db/schema';
import { sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

/**
 * 紧急清理脚本
 * 1. 禁用 admin 用户或重置为随机密码
 * 2. 清空所有 sessions
 */
async function cleanup() {
  console.log('🚨 Starting emergency cleanup of leaked data...');

  // 1. 清空所有会话，强制所有用户重新登录
  await db.delete(schema.sessions).execute();
  console.log('✅ All active sessions cleared.');

  // 2. 将 admin 用户密码重置为随机值（防止通过泄露的密码登录）
  const randomLock = nanoid(32);
  await db.update(schema.accounts)
    .set({ password: randomLock })
    .where(sql`provider_id = 'credential'`);
  
  console.log('✅ All credential passwords locked with random strings.');
  console.log('✨ Cleanup complete. Please set INITIAL_ADMIN_PASSWORD in Vercel and run update script.');
  process.exit(0);
}

cleanup().catch(err => {
  console.error('❌ Cleanup failed:', err);
  process.exit(1);
});
