/**
 * Portal 数据库连接
 * 使用 Drizzle ORM + postgres-js 连接 PostgreSQL
 *
 * Portal 自身即是 OIDC Provider，所有认证、会话、授权数据
 * 均与业务数据存储在同一个数据库中
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