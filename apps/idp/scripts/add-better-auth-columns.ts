/**
 * 添加 Better Auth 兼容字段
 */
import postgres from 'postgres';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL!;

async function main() {
  const sql = postgres(connectionString);

  // oauth_access_tokens 表字段
  const accessTokenColumns = [
    'access_token text',
    'refresh_token text',
    'access_token_expires_at timestamp',
    'refresh_token_expires_at timestamp',
    'updated_at timestamp DEFAULT NOW()',
  ];

  for (const col of accessTokenColumns) {
    const colName = col.split(' ')[0];
    try {
      await sql.unsafe(`ALTER TABLE oauth_access_tokens ADD COLUMN IF NOT EXISTS ${col}`);
      console.log(`Added ${colName} column to oauth_access_tokens`);
    } catch (e: any) {
      if (e.message?.includes('already exists') || e.message?.includes('duplicate')) {
        console.log(`${colName} column already exists in oauth_access_tokens`);
      } else {
        console.error(`Error adding ${colName} column:`, e.message);
      }
    }
  }

  // oauth_refresh_tokens 表字段
  const refreshTokenColumns = [
    'refresh_token text',
    'updated_at timestamp DEFAULT NOW()',
  ];

  for (const col of refreshTokenColumns) {
    const colName = col.split(' ')[0];
    try {
      await sql.unsafe(`ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS ${col}`);
      console.log(`Added ${colName} column to oauth_refresh_tokens`);
    } catch (e: any) {
      if (e.message?.includes('already exists') || e.message?.includes('duplicate')) {
        console.log(`${colName} column already exists in oauth_refresh_tokens`);
      } else {
        console.error(`Error adding ${colName} column:`, e.message);
      }
    }
  }

  await sql.end();
  console.log('Done!');
}

main().catch(console.error);