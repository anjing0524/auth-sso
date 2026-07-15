/**
 * Vitest Global Setup
 *
 * 在所有测试文件运行前执行：
 * 1. 确认测试数据库可用
 * 2. 运行 Drizzle 迁移
 */
import postgres from 'postgres';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

export async function setup() {
  const testUrl =
    process.env['TEST_DATABASE_URL'] ||
    process.env['DATABASE_URL'] ||
    'postgresql://postgres:postgres@localhost:5432/auth_sso_test';

  console.log(`\n[globalSetup] 连接测试数据库: ${testUrl.replace(/\/\/.*@/, '//***@')}`);

  const sql = postgres(testUrl, { max: 1, idle_timeout: 10 });

  try {
    // 检查连接
    await sql`SELECT 1`;

    // 运行 migration SQL 文件
    const drizzleDir = join(__dirname, 'drizzle');
    const files = readdirSync(drizzleDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (files.length > 0) {
      console.log(`[globalSetup] 运行 ${files.length} 个 migration 文件...`);
      for (const file of files) {
        const content = readFileSync(join(drizzleDir, file), 'utf-8');
        // 跳过 CREATE TYPE 语句（如果枚举已存在）和创建数据库语句
        const statements = content
          .split(';')
          .map(s => s.trim())
          .filter(s => s.length > 0 && !s.startsWith('--'));

        for (const stmt of statements) {
          try {
            await sql.unsafe(stmt + ';');
          } catch (err: any) {
            // 忽略 "already exists" 错误（幂等）
            if (!err.message?.includes('already exists') && !err.message?.includes('duplicate')) {
              console.warn(`[globalSetup] SQL 警告: ${err.message?.slice(0, 100)}`);
            }
          }
        }
      }
    }

    console.log('[globalSetup] 测试数据库就绪');
  } finally {
    await sql.end();
  }
}

export function teardown() {
  // 无清理操作
}
