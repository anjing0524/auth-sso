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

/** 默认每页条数（`parsePagination` 与页面层的共同默认） */
const DEFAULT_PAGE_SIZE = 20;

/**
 * 把单个输入归一为「>= 1 的整数」；无法解析（NaN/Infinity/0/负/小数截断后 <1）时取 fallback。
 *
 * 单点判据：`clampPage` / `clampPageSize` / `offsetFor` 都用它，保证三处语义一致
 * （此前页面层裸 `parseInt`、`audit/data.ts` 另写一份 `clamp`，三套判据互不相同）。
 */
function normalizePositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const truncated = Math.trunc(value);
  return truncated >= 1 ? truncated : fallback;
}

/**
 * 钳制**页码**（页面 Server Component 与 API 路由共用同一判据）。
 *
 * 非法输入（`?page=0`、`?page=abc`、`?page=-5`、缺省）一律回到 `fallback`（默认第 1 页）。
 *
 * 存在的理由：页面层此前用裸 `parseInt(params.page || '1')`，而数据层把它直接换算成
 * `.offset((page - 1) * pageSize)` ⇒ `?page=0` 得到 `OFFSET -20`、`?page=abc` 得到
 * `OFFSET NaN`，两者都是 PostgreSQL 错误 ⇒ 用户手改 URL 就得到 **500**。
 *
 * @param raw 查询参数原值（字符串）或已解析的数字
 * @param fallback 无法解析时的页码（默认 1）
 */
export function clampPage(raw: string | number | undefined | null, fallback = 1): number {
  return normalizePositiveInt(typeof raw === 'string' ? parseInt(raw, 10) : (raw ?? Number.NaN), fallback);
}

/**
 * 钳制**每页条数**：解析失败或非正数回到 `fallback`，否则夹到 `[1, MAX_PAGE_SIZE]`。
 *
 * @param raw 查询参数原值（字符串）或已解析的数字
 * @param fallback 无法解析时的每页条数（默认 20）
 */
export function clampPageSize(
  raw: string | number | undefined | null,
  fallback = DEFAULT_PAGE_SIZE,
): number {
  const parsed = normalizePositiveInt(
    typeof raw === 'string' ? parseInt(raw, 10) : (raw ?? Number.NaN),
    fallback,
  );
  return Math.min(MAX_PAGE_SIZE, parsed);
}

/**
 * `LIMIT/OFFSET` 的 OFFSET 计算 —— **恒为非负整数**。
 *
 * 这是「非法页码不得到达 SQL」的最后一道结构保证：即便某个调用方忘了先 `clampPage`，
 * `.offset(offsetFor(page, pageSize))` 也不会产生负值或 NaN。
 * （`pageSize` 同样被归一：`< 1` 视为 1。）
 */
export function offsetFor(page: number, pageSize: number): number {
  return (normalizePositiveInt(page, 1) - 1) * normalizePositiveInt(pageSize, 1);
}

/**
 * 读模型入口的分页归一 —— **一次钳制，三处共用**（`LIMIT`、`OFFSET`、返回的元信息）。
 *
 * 存在的理由：`withPagination` 会用传入的 `page` 拼装返回的 `pagination.page`，
 * 若读模型只把 `offsetFor` 用在 SQL 上而元信息仍用原始入参，`?page=0` 会返回
 * 「第 0 页」（虽然不再 500）。归一放在入口，三者就必然一致。
 */
export function normalizePagination(page: number, pageSize: number): ParsedPagination {
  return { page: clampPage(page), pageSize: clampPageSize(pageSize) };
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
  defaultPageSize: number = DEFAULT_PAGE_SIZE,
): ParsedPagination {
  return {
    page: clampPage(sp.get('page')),
    pageSize: clampPageSize(sp.get('pageSize'), defaultPageSize),
  };
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
