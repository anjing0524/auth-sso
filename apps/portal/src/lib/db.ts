/**
 * Portal 数据库连接
 * 使用 Drizzle ORM + postgres-js 连接 PostgreSQL
 *
 * 与 IdP 共享同一个数据库
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';

/**
 * 数据库连接配置
 */
const connectionString = process.env.DATABASE_URL!;

/**
 * Postgres 客户端
 */
const client = postgres(connectionString, {
  prepare: false, // 禁用 prepared statements 以提高 Serverless 兼容性
});

/**
 * Drizzle ORM 实例
 */
export const db = drizzle(client, { schema });

/**
 * 导出 schema 以便其他模块使用
 */
export { schema };