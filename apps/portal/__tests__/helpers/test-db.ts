/**
 * 测试数据库工具 (Integration Test DB)
 *
 * 支持两种隔离模式：
 *
 * 1. TRUNCATE CASCADE（默认）— 每个测试前清空所有表
 *    - 简单可靠，无事务管理复杂性
 *    - 配套 vitest.config.ts 中 fileParallelism: false 确保文件间串行
 *
 * 2. ROLLBACK（推荐，{ isolation: 'rollback' }）— 事务 + SAVEPOINT 隔离
 *    - 文件级 BEGIN/ROLLBACK 包裹，测试间 SAVEPOINT 隔离
 *    - 无需每次 TRUNCATE，速度更快
 *    - 为未来文件级并行做铺垫
 *
 * 使用方式（TRUNCATE 模式）：
 * ```
 * const testDb = createTestDbHandle();
 * beforeAll(() => testDb.connect());
 * afterAll(() => testDb.close());
 * beforeEach(() => testDb.cleanup());
 * ```
 *
 * 使用方式（ROLLBACK 模式）：
 * ```
 * const testDb = createTestDbHandle({ isolation: 'rollback' });
 * beforeAll(async () => {
 *   await testDb.connect();
 *   await testDb.sql`BEGIN`;
 * });
 * afterAll(async () => { await testDb.sql`ROLLBACK`; await testDb.close(); });
 * beforeEach(async () => { await testDb.sql`SAVEPOINT test_sp`; });
 * afterEach(async () => { await testDb.sql`ROLLBACK TO SAVEPOINT test_sp`; });
 * ```
 */
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type TestDb = PostgresJsDatabase<typeof schema>;

const TEST_DB_URL =
  process.env['TEST_DATABASE_URL'] ||
  process.env['DATABASE_URL'] ||
  'postgresql://postgres:postgres@localhost:5432/auth_sso_test';

export interface TestDbHandleOptions {
  /** 隔离模式：'truncate'（默认）或 'rollback'（事务隔离） */
  isolation?: 'truncate' | 'rollback';
}

export interface TestDbHandle {
  db: TestDb;
  sql: ReturnType<typeof postgres>;
  schema: typeof schema;
  connect(): Promise<void>;
  close(): Promise<void>;
  /** 清空所有表（按 FK 依赖顺序）。仅 TRUNCATE 模式需要调用 */
  cleanup(): Promise<void>;
}

export function createTestDbHandle(options: TestDbHandleOptions = {}): TestDbHandle {
  const { isolation = 'truncate' } = options;
  let _sql: ReturnType<typeof postgres> | null = null;
  let _db: TestDb | null = null;

  const handle: TestDbHandle = {
    get db() {
      if (!_db) throw new Error('测试数据库未初始化，请先调用 connect()');
      return _db;
    },
    get sql() {
      if (!_sql) throw new Error('测试数据库未初始化，请先调用 connect()');
      return _sql;
    },
    get schema() {
      return schema;
    },

    async connect() {
      if (_sql) return;
      _sql = postgres(TEST_DB_URL, { max: 1, idle_timeout: 30 });
      _db = drizzle(_sql, { schema });
    },

    async close() {
      if (_sql) {
        await _sql.end();
        _sql = null;
        _db = null;
      }
    },

    async cleanup() {
      if (!_sql) throw new Error('请先调用 connect()');
      // ROLLBACK 模式下，cleanup() 仅保证初始状态存在，由 SAVEPOINT 隔离
      // TRUNCATE 模式下，执行全表清空
      if (isolation === 'rollback') return;
      await _sql.unsafe(`
        TRUNCATE
          audit_logs, login_logs, access_logs,
          authorization_codes, refresh_tokens, access_tokens,
          user_roles, role_permissions,
          users, roles, permissions, departments, clients, jwks
        CASCADE
      `);
    },
  };

  return handle;
}

// ── Seed 工具 ──────────────────────────────────────────────

export interface SeedData {
  departments?: Array<typeof schema.departments.$inferInsert>;
  users?: Array<typeof schema.users.$inferInsert>;
  roles?: Array<typeof schema.roles.$inferInsert>;
  permissions?: Array<typeof schema.permissions.$inferInsert>;
  clients?: Array<typeof schema.clients.$inferInsert>;
  rolePermissions?: Array<typeof schema.rolePermissions.$inferInsert>;
  userRoles?: Array<typeof schema.userRoles.$inferInsert>;
  jwks?: Array<typeof schema.jwks.$inferInsert>;
  authorizationCodes?: Array<typeof schema.authorizationCodes.$inferInsert>;
  refreshTokens?: Array<typeof schema.refreshTokens.$inferInsert>;
}

/**
 * 种子数据插入（按 FK 依赖顺序）
 */
export async function seedTestData(db: TestDb, data: SeedData): Promise<void> {
  if (data.departments?.length) await db.insert(schema.departments).values(data.departments);
  if (data.users?.length) await db.insert(schema.users).values(data.users);
  if (data.roles?.length) await db.insert(schema.roles).values(data.roles);
  if (data.permissions?.length) await db.insert(schema.permissions).values(data.permissions);
  if (data.clients?.length) await db.insert(schema.clients).values(data.clients);
  if (data.rolePermissions?.length) await db.insert(schema.rolePermissions).values(data.rolePermissions);
  if (data.userRoles?.length) await db.insert(schema.userRoles).values(data.userRoles);
  if (data.jwks?.length) await db.insert(schema.jwks).values(data.jwks);
  if (data.authorizationCodes?.length) await db.insert(schema.authorizationCodes).values(data.authorizationCodes);
  if (data.refreshTokens?.length) await db.insert(schema.refreshTokens).values(data.refreshTokens);
}
