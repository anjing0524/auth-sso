/**
 * Portal 数据库连接
 * 使用 Drizzle ORM + neon-http 连接 PostgreSQL
 *
 * 与 IdP 共享同一个数据库
 */
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '../db/schema';

/**
 * 数据库连接配置
 */
const connectionString = process.env.DATABASE_URL!;

/**
 * Neon HTTP 客户端
 */
const sql = neon(connectionString);

/**
 * Drizzle ORM 实例
 */
export const db = drizzle({ client: sql, schema });

/**
 * 导出 schema 以便其他模块使用
 */
export { schema };