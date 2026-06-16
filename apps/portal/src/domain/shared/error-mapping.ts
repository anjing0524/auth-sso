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
 * 将领域错误统一映射为 HTTP 语义
 *
 * @param err 捕获的异常对象
 * @returns 标准化的错误映射结果，可直接返回给客户端
 */
export function mapDomainError(err: unknown): ErrorMapping {
  if (err instanceof EntityNotFoundError) {
    return { status: 404, error: err.code, message: err.message };
  }
  if (err instanceof DuplicateEntityError) {
    return { status: 409, error: err.code, message: err.message };
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
