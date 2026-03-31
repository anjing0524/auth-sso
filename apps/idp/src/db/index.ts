/**
 * 数据库连接模块
 * 使用 Drizzle ORM 连接 PostgreSQL
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * 数据库连接配置
 */
const connectionString = process.env.DATABASE_URL!;

/**
 * PostgreSQL 连接实例
 * 用于查询
 */
const queryClient = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

/**
 * Drizzle ORM 实例
 */
export const db = drizzle(queryClient, { schema });

/**
 * 关闭数据库连接
 */
export async function closeDb(): Promise<void> {
  await queryClient.end();
}

/**
 * 获取数据库实例
 * 用于事务等操作
 */
export function getDb() {
  return db;
}