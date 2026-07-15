/**
 * 测试数据库工具 (Integration Test DB)
 *
 * 采用 TRUNCATE CASCADE 模式实现测试隔离：
 * - 每个测试前清空所有表，然后 seed 测试数据
 * - 简单可靠，无事务管理复杂性
 * - 配套 vitest.config.ts 中 fileParallelism: false 确保文件间串行
 *
 * 使用方式（每个测试文件）：
 * ```
 * const testDb = createTestDbHandle();
 *
 * vi.mock('@/infrastructure/db', () => ({
 *   get db() { return testDb.db; },
 *   get schema() { return testDb.schema; },
 * }));
 *
 * beforeAll(() => testDb.connect());
 * afterAll(() => testDb.close());
 * beforeEach(() => testDb.cleanup());
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

export interface TestDbHandle {
  db: TestDb;
  sql: ReturnType<typeof postgres>;
  schema: typeof schema;
  connect(): Promise<void>;
  close(): Promise<void>;
  /** 清空所有表（按 FK 依赖顺序） */
  cleanup(): Promise<void>;
}

export function createTestDbHandle(): TestDbHandle {
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
