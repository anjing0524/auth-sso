/**
 * Vitest Global Setup
 *
 * 在所有测试文件运行前执行：
 * 1. 确认测试数据库可用
 * 2. 运行 Drizzle 迁移
 * 3. 确认测试 Redis 可用（硬失败，见 probeRedis）
 */
import postgres from 'postgres';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createTestRedisClient, resolveTestRedisUrl } from './vitest.redis';

/** 连接串脱敏：只隐去凭据，保留主机与逻辑库（日志与证据锚点需要可辨识） */
function redactUrl(url: string): string {
  return url.replace(/\/\/.*@/, '//***@');
}

function buildSetupHint(testUrl: string): string {
  return [
    `[globalSetup] 无法连接测试数据库: ${redactUrl(testUrl)}`,
    '[globalSetup] Portal API 测试以 Docker Compose 中的 postgres/redis 为唯一基础设施基线。',
    '[globalSetup] 先执行 `docker compose up -d postgres redis`，确认 `auth-sso-postgres` 与 `auth-sso-redis` healthy，再重试 Vitest。',
    '[globalSetup] 若本机运行了其他 Compose 栈，请检查它是否占用了 5432/6379，或没有把 PostgreSQL 暴露到 127.0.0.1:5432。',
  ].join('\n');
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function buildRedisSetupHint(redisUrl: string): string {
  return [
    `[globalSetup] 无法连接测试 Redis: ${redactUrl(redisUrl)}`,
    '[globalSetup] Portal API 测试以 Docker Compose 中的 postgres/redis 为唯一基础设施基线。',
    '[globalSetup] 先执行 `docker compose up -d postgres redis`，确认 `auth-sso-postgres` 与 `auth-sso-redis` healthy，再重试 Vitest。',
    '[globalSetup] 若本机运行了其他 Compose 栈占用 6379，或 Redis 不在 127.0.0.1，请用 `TEST_REDIS_URL` 指向可用的测试实例。',
    '[globalSetup] URL 未显式带逻辑库时会补 `/1`；若目标不支持 SELECT（如托管 Redis），请显式写库号，例如 `TEST_REDIS_URL=rediss://host:6379/0`。',
    '[globalSetup] 注意：探针与每个用例都会 FLUSHDB 所选逻辑库，`TEST_REDIS_URL` 必须指向一次性的测试实例/库，不可指向在用数据。',
    '[globalSetup] 注意：API project 需要真实 Redis——缺它时撤销类断言会天然为真、未撤销类负例会假红（混合信号），因此这里硬失败。',
  ].join('\n');
}

/**
 * 真实 Redis 硬探针：PING + 写读删往返 + FLUSHDB 生效校验。
 *
 * 三者缺一不可：
 * - 只 PING 无法证明读写权限与命令可用性；
 * - FLUSHDB 校验失败（受管 Redis 可能禁用该命令）时，每用例隔离的前提不成立，
 *   而隔离失效会让用例之间互相污染，比"直接报错"更难诊断。
 */
async function probeRedis(redisUrl: string): Promise<void> {
  const client = createTestRedisClient(redisUrl);

  const probeKey = `portal:globalSetup:probe:${process.pid}`;

  try {
    await client.connect();

    const pong = await client.ping();
    if (pong !== 'PONG') {
      throw new Error(`PING 返回 ${pong}`);
    }

    await client.setex(probeKey, 30, 'ok');
    const readBack = await client.get(probeKey);
    if (readBack !== 'ok') {
      throw new Error(`写读往返失败：GET 返回 ${readBack === null ? 'null' : `"${readBack}"`}`);
    }
    const deleted = await client.del(probeKey);
    if (deleted !== 1) {
      throw new Error(`删除往返失败：DEL 返回 ${deleted}`);
    }

    await client.setex(probeKey, 30, 'ok');
    await client.flushdb();
    const remaining = await client.exists(probeKey);
    if (remaining !== 0) {
      throw new Error('FLUSHDB 未生效：写入的探针键仍然存在');
    }
  } finally {
    await client.quit().catch(() => {});
  }
}

async function ensureDatabaseExists(testUrl: string): Promise<void> {
  const parsed = new URL(testUrl);
  const databaseName = parsed.pathname.replace(/^\//, '');
  if (!databaseName) {
    throw new Error(`[globalSetup] 测试数据库 URL 缺少 database 名称: ${redactUrl(testUrl)}`);
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

/**
 * 真实 Redis 硬探针的执行入口：打印探针前后的锚点行，失败时抛出带操作提示的错误。
 * 独立成函数，避免把 setup() 的条件分支数进一步推高（该函数本已超过 complexity 阈值）。
 */
async function assertTestRedisReady(): Promise<void> {
  const testRedisUrl = resolveTestRedisUrl();
  console.log(`\n[globalSetup] 连接测试 Redis: ${redactUrl(testRedisUrl)}`);

  try {
    await probeRedis(testRedisUrl);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`${buildRedisSetupHint(testRedisUrl)}\n[globalSetup] Redis 探针失败: ${details}`);
  }

  // 固定格式的证据锚点：变异验证记录必须逐字带上这一行
  console.log(`[globalSetup] Redis 就绪 ${redactUrl(testRedisUrl)}`);
}

/**
 * 执行单条 migration 语句：幂等错误（already exists / duplicate）只告警，其余也只告警不中断。
 *
 * 抽出来的理由（ADR-019 待修热点）：原来这段在
 * 「setup → try → for(files) → for(statements) → try → catch → if」里嵌套 6 层；
 * 抽成具名函数后两处主流程都回到线性。
 */
async function applyStatementIgnoringIdempotentErrors(
  sql: postgres.Sql,
  stmt: string,
): Promise<void> {
  try {
    await sql.unsafe(stmt);
  } catch (err: any) {
    // 忽略 "already exists" 错误（幂等）
    if (!err.message?.includes('already exists') && !err.message?.includes('duplicate')) {
      console.warn(`[globalSetup] SQL 警告: ${err.message?.slice(0, 100)}`);
    }
  }
}

/**
 * 运行 drizzle 目录下的全部 migration SQL。
 *
 * Drizzle 的断点是 migration 的执行单元。**不能按分号拆分**：分区维护等
 * PostgreSQL 块会使用 `DO $$ …; … $$`，在块内拆分会破坏语法。
 */
async function applyDrizzleMigrations(sql: postgres.Sql, drizzleDir: string): Promise<void> {
  const files = readdirSync(drizzleDir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) return;

  console.log(`[globalSetup] 运行 ${files.length} 个 migration 文件...`);
  for (const file of files) {
    const content = readFileSync(join(drizzleDir, file), 'utf-8');
    const statements = content
      .split(/^--> statement-breakpoint\s*$/m)
      .map(s => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      await applyStatementIgnoringIdempotentErrors(sql, stmt);
    }
  }
}

export async function setup() {
  const testUrl =
    process.env['TEST_DATABASE_URL'] ||
    process.env['DATABASE_URL'] ||
    'postgresql://postgres:postgres@127.0.0.1:5432/auth_sso_test';

  console.log(`\n[globalSetup] 连接测试数据库: ${redactUrl(testUrl)}`);

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

    // 运行 migration SQL 文件（抽取成具名函数：见 applyDrizzleMigrations 的说明）
    await applyDrizzleMigrations(sql, join(__dirname, 'drizzle'));

    console.log('[globalSetup] 测试数据库就绪');
  } finally {
    await sql.end();
  }

  await assertTestRedisReady();
}

export function teardown() {
  // 无清理操作
}
