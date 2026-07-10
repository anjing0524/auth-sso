/**
 * 过期令牌与授权码清理脚本
 *
 * 职责：定期清理 OAuth 流程中累积的过期/已消费数据，防止表无限膨胀。
 *   1. authorization_codes：删除已过期或已使用的授权码（保留 1 天 grace period 供排障）
 *   2. refresh_tokens：删除已撤销且超过保留期的刷新令牌（保留 7 天供审计）
 *   3. access_tokens：删除已过期的访问令牌元数据（预留表，若有数据则清理）
 *
 * 运行：cd apps/portal && DATABASE_URL=<url> tsx scripts/cleanup-expired-tokens.ts
 * 建议通过 cron 定时执行（如每日凌晨）。
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../src/db/schema';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`❌ 缺少必要环境变量: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  console.log('🧹 开始清理过期令牌...');

  const connectionString = requireEnv('DATABASE_URL');
  const needsSsl = connectionString.includes('sslmode=require')
    || connectionString.includes('.neon.tech')
    || connectionString.includes('.supabase.co');
  const client = postgres(connectionString, needsSsl ? { ssl: 'require' } : {});
  const db = drizzle(client, { schema });

  try {
    // 1. 授权码：删除已过期（超 1 天）或已使用的记录
    const authCodeResult = await db.execute(sql`
      DELETE FROM authorization_codes
      WHERE expires_at < NOW() - INTERVAL '1 day'
         OR (used = true AND created_at < NOW() - INTERVAL '1 day')
    `);
    console.log(`  ✅ authorization_codes 清理: ${authCodeResult.count ?? '?'} 行`);

    // 2. 刷新令牌：删除已撤销且超过 7 天保留期的记录
    const refreshTokenResult = await db.execute(sql`
      DELETE FROM refresh_tokens
      WHERE revoked IS NOT NULL
        AND revoked < NOW() - INTERVAL '7 days'
    `);
    console.log(`  ✅ refresh_tokens 清理: ${refreshTokenResult.count ?? '?'} 行`);

    // 3. 访问令牌元数据：删除已过期的记录（预留表，通常无数据）
    const accessTokenResult = await db.execute(sql`
      DELETE FROM access_tokens
      WHERE expires_at < NOW()
    `);
    console.log(`  ✅ access_tokens 清理: ${accessTokenResult.count ?? '?'} 行`);

    console.log('\n✨ 清理完成');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('\n❌ 清理失败:', err.message);
  process.exit(1);
});
