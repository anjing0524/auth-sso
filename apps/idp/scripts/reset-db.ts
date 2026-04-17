import { db } from '../src/db';
import * as schema from '../src/db/schema';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('🗑️  Resetting database...');

  try {
    // 禁用外键检查 (针对 PostgreSQL)
    await db.execute(sql`TRUNCATE TABLE "users", "accounts", "sessions", "roles", "permissions", "user_roles", "role_permissions", "clients", "authorization_codes", "oauth_access_tokens", "oauth_refresh_tokens", "oauth_consent", "departments" RESTART IDENTITY CASCADE`);
    
    console.log('✅ Database truncated successfully.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Reset failed:', error);
    process.exit(1);
  }
}

main();
