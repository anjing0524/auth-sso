/**
 * 错误映射横切层 (Cross-cutting Error Mapping)
 *
 * Controller 层统一通过 mapDomainError() 将领域错误转为 HTTP 语义，
 * 严禁在各 Controller 中手写 instanceof 分支。
 *
 * 设计原则：这是 Controller 层唯一的错误处理入口（防腐关口）。
 */
import {
  DomainError,
  EntityNotFoundError,
  BusinessRuleViolationError,
  DuplicateEntityError,
  InvalidClientError,
  InvalidGrantError,
  PKCEVerificationError,
  InvalidRedirectUriError,
  ForbiddenError,
} from './errors';
import { COMMON_ERRORS } from '@auth-sso/contracts';

/** 错误映射结果，可直接用于构造 HTTP 响应 */
interface ErrorMapping {
  /** HTTP 状态码 */
  status: number;
  /** 错误码（如 AUTH_SSO_3002） */
  error: string;
  /** 人类可读的错误描述 */
  message: string;
}

/**
 * 判断错误是否为 Next.js 构建期（静态预渲染 / Partial Prerendering）的正常中断信号。
 * React 通过 Suspense 边界正确处理这类异常——它们不是真正的运行时错误。
 */
function isPrerenderingError(err: unknown): boolean {
  return err instanceof Error && (
    err.message.includes('prerender') ||
    err.message.includes('Prerendering') ||
    err.message.includes('NEXT_PRERENDER')
  );
}

/**
 * 将领域错误统一映射为 HTTP 语义
 *
 * @param err 捕获的异常对象
 * @returns 标准化的错误映射结果，可直接返回给客户端
 */
export function mapDomainError(err: unknown): ErrorMapping {
  // 预渲染中断信号不是真正的错误——Next.js 会自动回退到请求时渲染
  if (isPrerenderingError(err)) {
    return { status: 500, error: COMMON_ERRORS.INTERNAL_ERROR, message: '服务器内部错误' };
  }

  if (err instanceof EntityNotFoundError) {
    return { status: 404, error: err.code, message: err.message };
  }
  if (err instanceof ForbiddenError) {
    return { status: 403, error: err.code, message: err.message };
  }
  if (err instanceof DuplicateEntityError) {
    return { status: 409, error: err.code, message: err.message };
  }
  if (err instanceof InvalidClientError) {
    return { status: 401, error: err.code, message: err.message };
  }
  if (err instanceof InvalidGrantError) {
    return { status: 400, error: err.code, message: err.message };
  }
  if (err instanceof PKCEVerificationError) {
    return { status: 400, error: err.code, message: err.message };
  }
  if (err instanceof InvalidRedirectUriError) {
    return { status: 400, error: err.code, message: err.message };
  }
  if (err instanceof BusinessRuleViolationError) {
    return { status: 422, error: err.code, message: err.message };
  }
  if (err instanceof DomainError) {
    return { status: 400, error: err.code, message: err.message };
  }
  // 未知异常统一 500（记录日志便于排查）
  console.error('[mapDomainError] 未预期的异常:', err);
  return { status: 500, error: COMMON_ERRORS.INTERNAL_ERROR, message: '服务器内部错误' };
}
