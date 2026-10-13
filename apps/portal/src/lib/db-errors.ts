/**
 * 数据库错误识别（PostgreSQL → 可判别的语义）
 *
 * 唯一职责：把 **PostgreSQL 唯一约束违例**（SQLSTATE `23505`）从 Drizzle 的
 * **包装错误**里认出来，供服务端边界（`lib/server-error.ts`）映射为 409。
 *
 * ## 为什么要走 `cause` 链
 *
 * Drizzle 抛的是 `DrizzleQueryError`：它自身**没有** `code` / `constraint`
 * （自有键只有 `query` / `params` / `cause`），真正的 `PostgresError` 挂在 `cause` 上。
 * 因此"直接读顶层 `error.code`"永远拿不到 `23505`——这正是
 * 「重复部门编码 → 500 而不是 409」被漏掉的机制。
 *
 * ## 为什么只取"表 + 列名"，绝不取 `detail` 里的值
 *
 * PG 的 `detail` 形如 `Key (email)=(someone@x.com) already exists.`——**带值**，
 * 且那个值是**库里已存在的那个人**的邮箱/手机号/用户名。把它拼进用户可见消息
 * 就是泄露第三方数据。本模块只解析出列名，值一律丢弃。
 *
 * @module lib/db-errors
 */

/** 唯一约束违例的识别结果 */
export interface UniqueViolation {
  /** 违反约束的表名（Postgres 的 `table_name`）；不可得时为 null */
  readonly table: string | null;
  /** 参与唯一约束的列名（从 `detail` 解析，**不含值**）；解析不到时为空数组 */
  readonly columns: readonly string[];
}

/** `cause` 链的最大追溯深度（防御自引用/超长链） */
const MAX_CAUSE_DEPTH = 5;

/** PostgreSQL 唯一约束违例的 SQLSTATE */
const UNIQUE_VIOLATION_SQLSTATE = '23505';

/** `Key (col_a, col_b)=(…) already exists.` —— 只捕获括号内的列名 */
const DETAIL_KEY_COLUMNS = /^Key \(([^)]*)\)=/;

/**
 * 沿 `cause` 链查找 PostgreSQL 唯一约束违例。
 *
 * **非唯一违例必须返回 null**：`23502`（not-null）、`23503`（外键）等同样是数据库错误，
 * 但语义不是"冲突"。把一切 DB 错误都报成冲突会让真实故障被误诊——
 * 这也是本模块只认一个 SQLSTATE 的原因。
 *
 * @param error 任意被抛出的值（通常是 Drizzle 的包装错误）
 * @returns 识别结果；不是唯一违例时返回 null
 */
export function uniqueViolation(error: unknown): UniqueViolation | null {
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (typeof current !== 'object' || current === null) return null;

    const e = current as {
      code?: unknown;
      table_name?: unknown;
      detail?: unknown;
      cause?: unknown;
    };

    if (e.code === UNIQUE_VIOLATION_SQLSTATE) {
      const table = typeof e.table_name === 'string' ? e.table_name : null;
      const columns =
        typeof e.detail === 'string'
          ? (DETAIL_KEY_COLUMNS.exec(e.detail)?.[1] ?? '')
              .split(',')
              .map((name) => name.trim())
              .filter((name) => name.length > 0)
          : [];
      return { table, columns };
    }

    current = e.cause;
  }

  return null;
}
