/**
 * 数据库连接模块
 * 在生产环境下使用 postgres-js 以获得最高稳定性
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;

// 生产环境下使用单例连接
const client = postgres(connectionString, {
  prepare: false, // 禁用 prepared statements 以提高 Serverless 兼容性
});

export const db = drizzle(client, { schema });

export function getDb() {
  return db;
}
