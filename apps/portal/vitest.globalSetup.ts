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

function redactDatabaseUrl(url: string): string {
  return url.replace(/\/\/.*@/, '//***@');
}

function buildSetupHint(testUrl: string): string {
  return [
    `[globalSetup] 无法连接测试数据库: ${redactDatabaseUrl(testUrl)}`,
    '[globalSetup] Portal API 测试以 Docker Compose 中的 postgres/redis 为唯一基础设施基线。',
    '[globalSetup] 先执行 `docker compose up -d postgres redis`，确认 `auth-sso-postgres` 与 `auth-sso-redis` healthy，再重试 Vitest。',
    '[globalSetup] 若本机运行了其他 Compose 栈，请检查它是否占用了 5432/6379，或没有把 PostgreSQL 暴露到 127.0.0.1:5432。',
  ].join('\n');
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function ensureDatabaseExists(testUrl: string): Promise<void> {
  const parsed = new URL(testUrl);
  const databaseName = parsed.pathname.replace(/^\//, '');
  if (!databaseName) {
    throw new Error(`[globalSetup] 测试数据库 URL 缺少 database 名称: ${redactDatabaseUrl(testUrl)}`);
  }

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';

  const adminSql = postgres(adminUrl.toString(), {
    max: 1,
    idle_timeout: 10,
    connect_timeout: 5,
  });

  try {
    const rows = await adminSql<{ exists: boolean }[]>`
      SELECT EXISTS(
        SELECT 1
        FROM pg_database
        WHERE datname = ${databaseName}
      ) AS "exists"
    `;

    if (!rows[0]?.exists) {
      console.log(`[globalSetup] 创建缺失的测试数据库: ${databaseName}`);
      await adminSql.unsafe(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    }
  } finally {
    await adminSql.end();
  }
}

export async function setup() {
  const testUrl =
    process.env['TEST_DATABASE_URL'] ||
    process.env['DATABASE_URL'] ||
    'postgresql://postgres:postgres@127.0.0.1:5432/auth_sso_test';

  console.log(`\n[globalSetup] 连接测试数据库: ${redactDatabaseUrl(testUrl)}`);

  try {
    await ensureDatabaseExists(testUrl);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`${buildSetupHint(testUrl)}\n[globalSetup] 创建/检查测试数据库失败: ${details}`);
  }

  const sql = postgres(testUrl, {
    max: 1,
    idle_timeout: 10,
    connect_timeout: 5,
  });

  try {
    // 检查连接
    try {
      await sql`SELECT 1`;
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      throw new Error(`${buildSetupHint(testUrl)}\n[globalSetup] 原始错误: ${details}`);
    }

    // 运行 migration SQL 文件
    const drizzleDir = join(__dirname, 'drizzle');
    const files = readdirSync(drizzleDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (files.length > 0) {
      console.log(`[globalSetup] 运行 ${files.length} 个 migration 文件...`);
      for (const file of files) {
        const content = readFileSync(join(drizzleDir, file), 'utf-8');
        // Drizzle 的断点是 migration 的执行单元。不能按分号拆分：分区维护
        // 等 PostgreSQL 块会使用 DO $$ ...; ... $$，在块内拆分会破坏语法。
        const statements = content
          .split(/^--> statement-breakpoint\s*$/m)
          .map(s => s.trim())
          .filter(Boolean);

        for (const stmt of statements) {
          try {
            await sql.unsafe(stmt);
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
