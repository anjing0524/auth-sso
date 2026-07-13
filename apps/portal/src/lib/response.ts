import 'server-only';
import { NextResponse } from 'next/server';

/**
 * 统一 API 响应工厂
 *
 * 消除项目中 4 种互不一致的响应格式，所有端点统一使用以下工厂函数。
 *
 * 响应契约对齐 @auth-sso/contracts ApiResponse 定义：
 *   成功: { success: true, data: T, pagination?: { page, pageSize, total, totalPages } }
 *   错误: { success: false, error: string, message: string }
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

/**
 * 构建统一成功响应（符合 ApiSuccess<T> 契约）。
 *
 * @param data - 业务数据（ApiSuccess 要求必填 data；无业务数据时传 null 或空对象）
 * @param pagination - 列表分页元信息（可选）
 * @param status - HTTP 状态码（默认 200）
 */
export function apiSuccess<T>(
  data: T,
  pagination?: PaginationMeta,
  status: number = 200,
): NextResponse<{ success: true; data: T; pagination?: PaginationMeta }> {
  return NextResponse.json(
    { success: true as const, data, ...(pagination ? { pagination } : {}) },
    { status },
  );
}

/**
 * 构建统一错误响应（符合 ApiError 契约）。
 *
 * @param code - 错误码（来自 @auth-sso/contracts errors.ts）
 * @param message - 人类可读错误描述
 * @param status - HTTP 状态码
 */
export function apiError(
  code: string,
  message: string,
  status: number,
): NextResponse<{ success: false; error: string; message: string }> {
  return NextResponse.json(
    { success: false as const, error: code, message },
    { status },
  );
}
