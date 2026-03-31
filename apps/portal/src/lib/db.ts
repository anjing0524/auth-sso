/**
 * Portal 数据库连接
 * 连接到 IdP 共享的数据库
 */
import postgres from 'postgres';

/**
 * 数据库连接配置
 */
const connectionString = process.env.DATABASE_URL!;

/**
 * PostgreSQL 连接实例
 */
const sql = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

/**
 * 执行 SQL 查询
 */
export const db = {
  query: sql,
  end: async () => await sql.end(),
};

export { sql };