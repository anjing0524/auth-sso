import 'server-only';

/**
 * 分页参数解析与读模型分页原语
 *
 * parsePagination：从 URLSearchParams 中提取并安全钳制 page/pageSize 参数（API 路由用）。
 * paginationMeta / withPagination / countRows：data.ts 读模型的 select+count+拼装
 * 五件套收敛点（Controller ≤20 行规范的配套设施）。
 *
 * @module lib/pagination
 */

import { count } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { db } from '@/infrastructure/db';
import { MAX_PAGE_SIZE } from '@auth-sso/contracts';

export interface ParsedPagination {
  page: number;
  pageSize: number;
}

/**
 * 从 URLSearchParams 中安全解析分页参数
 *
 * @param sp - URLSearchParams 实例
 * @param defaultPageSize - 默认 pageSize（不传默认 20）
 * @returns 钳制后的 { page, pageSize }（page >= 1, 1 <= pageSize <= MAX_PAGE_SIZE）
 */
export function parsePagination(
  sp: URLSearchParams,
  defaultPageSize: number = 20,
): ParsedPagination {
  const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
  const rawPageSize = parseInt(sp.get('pageSize') || String(defaultPageSize), 10);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, rawPageSize || defaultPageSize));
  return { page, pageSize };
}

// ── 读模型分页原语 ──

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** 由 total 拼装分页元信息（消除各读模型重复的对象字面量 + Math.ceil） */
export function paginationMeta(page: number, pageSize: number, total: number): PaginationMeta {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

/**
 * 并发执行"数据页 + 总数"两个查询并拼装分页结果。
 *
 * 设计动机：data.ts 读模型函数重复 select-limit-offset / count / 拼装五件套，
 * 是 Controller ≤20 行规范被系统性违反的主因；并发 Promise.all 顺带消除
 * rows 与 count 的串行往返。
 *
 * @param map 可选行映射器（日期序列化 / 展示兜底），传入时 data 为映射后类型
 */
export async function withPagination<T, R = T>(
  page: number,
  pageSize: number,
  rows: Promise<T[]>,
  totalRows: Promise<number>,
  map?: (row: T) => R,
): Promise<{ data: R[]; pagination: PaginationMeta }> {
  const [data, total] = await Promise.all([rows, totalRows]);
  return { data: map ? data.map(map) : (data as unknown as R[]), pagination: paginationMeta(page, pageSize, total) };
}

/** 单表（无 join）计数 — 与 withPagination 配套的 count 查询收敛点 */
export async function countRows(table: PgTable, where?: SQL): Promise<number> {
  const result = await db.select({ count: count() }).from(table).where(where);
  return Number(result[0]?.count ?? 0);
}
