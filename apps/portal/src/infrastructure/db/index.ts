/**
 * Portal 数据库连接 (Infrastructure Layer)
 * 使用 Drizzle ORM + postgres-js 连接 PostgreSQL
 *
 * Portal 自身即是 OIDC Provider，所有认证、会话、授权数据
 * 均与业务数据存储在同一个数据库中
 *
 * @module infrastructure/db
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema';
import { getDatabaseUrl } from '@auth-sso/config';

function createDatabase() {
  const client = postgres(getDatabaseUrl());
  return drizzle(client, { schema });
}

export type PortalDatabase = ReturnType<typeof createDatabase>;

let database: PortalDatabase | null = null;

/**
 * 首次真实数据库操作时初始化连接。
 *
 * Next.js 构建会求值 Route Handler / RSC 的模块图；导入数据库模块本身必须保持纯净，
 * 运行时缺少 DATABASE_URL 仍会在首次访问时通过 Zod fail-fast。
 */
export function getDb(): PortalDatabase {
  if (!database) {
    database = createDatabase();
  }
  return database;
}

/**
 * 保持现有 `db.select()` / `db.query.*` API，同时将初始化推迟到首次属性访问。
 */
export const db = new Proxy({} as PortalDatabase, {
  get(_target, property) {
    const instance = getDb();
    const value = Reflect.get(instance, property, instance);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});

/** 导出 schema 以便其他模块使用 */
export { schema };

/** Drizzle 事务句柄（db.transaction 回调参数类型） */
export type DbTxHandle = Parameters<Parameters<PortalDatabase['transaction']>[0]>[0];

/**
 * 通用数据库执行器：db 直连、事务句柄或等价的 drizzle postgres-js 实例（测试 TestDb）。
 * 需要"事务内外通用"的原语（RT 撤销、数据范围快照等）以此为首参，调用方传 tx 即获得真实事务语义。
 */
export type DbExecutor = PortalDatabase | DbTxHandle | PostgresJsDatabase<typeof schema>;
