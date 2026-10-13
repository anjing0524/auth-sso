import 'server-only';

import { unstable_rethrow } from 'next/navigation';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { DuplicateEntityError } from '@/domain/shared/errors';
import { uniqueViolation } from '@/lib/db-errors';

/**
 * Server Action / API Route 的**唯一**服务端错误映射入口。
 *
 * 保留 Next.js redirect、Request-time API 与 PPR 的框架控制流，仅映射应用错误。
 *
 * ## 为什么先认数据库唯一约束违例
 *
 * 唯一性冲突的三处既有实现是"事务内先查后写"（`users` / `roles` / `permissions`），
 * 而 `departments` 直接 insert ⇒ PG 违例经 `mapDomainError` 落到 500「服务器内部错误」。
 *
 * 先查后写本身**不是并发安全的**（两个并发请求都能通过检查，落库时后者仍违例），
 * 所以真正的保证点在**这里**：由数据库当唯一权威，把 `23505` 一次性翻译成
 * 领域语义的 409。既有的事务内查重因此退化为"更早给出消息"的优化，
 * 而非正确性依赖。
 *
 * ## 消息不含冲突值
 *
 * 实体名/字段名由 `table_name` + `detail` 的**列名**翻译而来；
 * `detail` 里的**值**（他人邮箱/手机号/用户名）一律不进入消息。
 */

/** 表名 → 用户可读实体名（未映射的回退为表名本身） */
const ENTITY_LABELS: Record<string, string> = {
  users: '用户',
  roles: '角色',
  permissions: '权限',
  departments: '部门',
  clients: '应用',
};

/** 列名 → 用户可读字段名（未映射的回退为列名本身） */
const FIELD_LABELS: Record<string, string> = {
  username: '用户名',
  email: '邮箱',
  mobile: '手机号',
  code: '编码',
  client_id: 'Client ID',
};

/** 唯一约束违例 → 409 的领域错误（消息不含冲突值） */
function conflictFromUniqueViolation(violation: {
  table: string | null;
  columns: readonly string[];
}): DuplicateEntityError {
  const entity = violation.table ? (ENTITY_LABELS[violation.table] ?? violation.table) : '记录';
  const field =
    violation.columns.length > 0
      ? violation.columns.map((column) => FIELD_LABELS[column] ?? column).join('/')
      : '唯一字段';
  return new DuplicateEntityError(entity, field);
}

export function mapServerError(error: unknown) {
  unstable_rethrow(error);

  const violation = uniqueViolation(error);
  if (violation) return mapDomainError(conflictFromUniqueViolation(violation));

  return mapDomainError(error);
}
