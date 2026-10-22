/**
 * 错误映射横切层 (Cross-cutting Error Mapping)
 *
 * Controller 层统一通过 mapDomainError() 将领域错误转为 HTTP 语义，
 * 严禁在各 Controller 中手写 instanceof 分支。
 *
 * 设计原则：这是 Controller 层唯一的错误处理入口（防腐关口）。
 */
import { DomainError } from './errors';
import { COMMON_ERRORS, AUTH_ERRORS, type ErrorCode } from '@auth-sso/contracts';

/** 错误映射结果，可直接用于构造 HTTP 响应 */
interface ErrorMapping {
  /** HTTP 状态码 */
  status: number;
  /** 错误码（如 AUTH_SSO_3002）—— 键入闭合词汇表，词汇表外的码无法流出 */
  error: ErrorCode;
  /** 人类可读的错误描述 */
  message: string;
}

export function mapDomainError(err: unknown): ErrorMapping {
  if (err instanceof DomainError) {
    // 状态码随实例走（err.status），不按构造函数名反查：生产压缩会重命名类，
    // 曾导致 403/404/409/422 全部退化为 400。
    return { status: err.status, error: err.code, message: err.message };
  }

  return { status: 500, error: COMMON_ERRORS.INTERNAL_ERROR, message: '服务器内部错误' };
}

/**
 * 内部错误码 → OAuth 2.1 标准错误码映射（RFC 6749 §5.2）。
 *
 * 键键入**闭合词汇表** `ErrorCode`：词汇表外的码（如曾经的裸 `'INVALID_SCOPE'`）
 * 无法成为键。`?? 'invalid_request'` 的兜底保留（RFC 6749 §5.2 的默认码），
 * 但它现在只可能服务"词汇表内但未列出的码"，而不再是词汇表漂移的遮羞布。
 */
const OAUTH_ERROR_MAP: Partial<Record<ErrorCode, string>> = {
  [AUTH_ERRORS.INVALID_CLIENT]: 'invalid_client',
  [AUTH_ERRORS.INVALID_CODE]: 'invalid_grant',
  [AUTH_ERRORS.PKCE_VERIFICATION_FAILED]: 'invalid_grant',
  [AUTH_ERRORS.OAUTH_INVALID_REDIRECT_URI]: 'invalid_grant',
  [AUTH_ERRORS.INVALID_SCOPE]: 'invalid_scope',
  [AUTH_ERRORS.UNSUPPORTED_GRANT_TYPE]: 'unsupported_grant_type',
};

/**
 * 将内部错误码映射为符合 RFC 6749 §5.2 的 OAuth 2.1 标准错误码
 *
 * 消除 token 端点中手写 if/else 分支映射，收敛到单一真相源。
 */
export function mapToOAuthError(internalError: ErrorCode): string {
  return OAUTH_ERROR_MAP[internalError] ?? 'invalid_request';
}
