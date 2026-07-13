import 'server-only';

/**
 * 分页参数解析工具
 *
 * 从 URLSearchParams 中提取并安全钳制 page/pageSize 参数，
 * 消除各路由文件中重复的内联分页解析逻辑。
 *
 * @module lib/pagination
 */

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
