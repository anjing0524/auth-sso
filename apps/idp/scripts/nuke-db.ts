import 'dotenv/config';
import postgres from 'postgres';

async function nuke() {
  console.log('🗑️ Nuking production database...');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is missing');

  const sql = postgres(connectionString, { ssl: 'require' });

  try {
    await sql`DROP SCHEMA IF EXISTS public CASCADE`;
    await sql`CREATE SCHEMA public`;
    await sql`GRANT ALL ON SCHEMA public TO public`;
    console.log('✅ Database is now blank and ready.');
  } finally {
    await sql.end();
  }
}

nuke().catch((err) => {
  console.error('❌ Nuke failed:', err);
  process.exit(1);
});
