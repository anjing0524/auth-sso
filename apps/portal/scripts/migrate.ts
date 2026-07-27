import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import postgres from 'postgres';
import './load-env';

function redactDatabaseUrl(url: string): string {
  return url.replace(/\/\/.*@/, '//***@');
}

function isIdempotentMigrationError(message: string): boolean {
  return message.includes('already exists') || message.includes('duplicate');
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL 未设置');
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 10,
    connect_timeout: 5,
  });

  try {
    await sql`SELECT 1`;

    const drizzleDir = join(process.cwd(), 'drizzle');
    const files = readdirSync(drizzleDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    console.log(`[db:migrate] 连接数据库: ${redactDatabaseUrl(databaseUrl)}`);
    console.log(`[db:migrate] 执行 ${files.length} 个 migration 文件`);

    for (const file of files) {
      const content = readFileSync(join(drizzleDir, file), 'utf-8');
      const statements = content
        .split(/^--> statement-breakpoint\s*$/m)
        .map((statement) => statement.trim())
        .filter(Boolean);

      console.log(`[db:migrate] applying ${file} (${statements.length} statements)`);

      for (const statement of statements) {
        try {
          await sql.unsafe(statement);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (isIdempotentMigrationError(message)) {
            console.warn(`[db:migrate] skip idempotent error in ${file}: ${message.slice(0, 160)}`);
            continue;
          }
          throw new Error(`[db:migrate] ${file} 执行失败: ${message}`);
        }
      }
    }

    console.log('[db:migrate] 完成');
  } finally {
    await sql.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
