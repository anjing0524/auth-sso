import 'server-only';
import { NextResponse } from 'next/server';

/**
 * API 响应工厂 — 严格区分 REST HTTP 端点与 Server Action 两种协议。
 *
 * REST HTTP 端点（route.ts）：
 *   成功 → HTTP 200 + 业务数据直出（无 success 包裹，HTTP 状态码即成功语义）
 *   错误 → HTTP 4xx/5xx + { error: string, message: string }
 *   列表 → { data: T[], pagination: P }
 *
 * Server Actions（actions.ts）：
 *   使用 ApiResponse<T> = { success: true, data: T } | { success: false, error, message }
 *   Server Action 是 RPC 调用，无 HTTP 协议层，success 字段承载成功/失败语义。
 *
 * OAuth2 端点遵循 RFC 6749 标准格式，不使用本模块。
 *
 * @module lib/response
 */

/** 分页元信息 */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ===================================================
// REST HTTP 端点工厂（route.ts 专用）
// ===================================================

/**
 * REST 成功响应 — 数据直出，HTTP 200 即成功语义。
 *
 * @param data - 业务数据
 * @param status - HTTP 状态码（默认 200）
 */
export function restSuccess<T>(data: T, status: number = 200): NextResponse<T> {
  return NextResponse.json(data as any, { status });
}

/**
 * REST 列表成功响应 — 含分页元信息。
 */
export function restListSuccess<T>(
  data: T[],
  pagination: PaginationMeta,
  status: number = 200,
): NextResponse<{ data: T[]; pagination: PaginationMeta }> {
  return NextResponse.json({ data, pagination }, { status });
}

/**
 * REST 错误响应 — { error, message }，无 success 字段。
 */
export function restError(
  code: string,
  message: string,
  status: number,
): NextResponse<{ error: string; message: string }> {
  return NextResponse.json({ error: code, message }, { status });
}
