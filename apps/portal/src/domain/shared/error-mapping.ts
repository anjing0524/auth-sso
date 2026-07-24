/**
 * 错误映射横切层 (Cross-cutting Error Mapping)
 *
 * Controller 层统一通过 mapDomainError() 将领域错误转为 HTTP 语义，
 * 严禁在各 Controller 中手写 instanceof 分支。
 *
 * 设计原则：这是 Controller 层唯一的错误处理入口（防腐关口）。
 */
import { DomainError } from './errors';
import { COMMON_ERRORS, AUTH_ERRORS } from '@auth-sso/contracts';

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
 * DomainError 子类 → HTTP 状态码注册表。
 * 新增错误类型只需在此追加一行，无需修改 mapDomainError 函数体。
 */
const ERROR_STATUS: Record<string, number> = {
  EntityNotFoundError: 404,
  ForbiddenError: 403,
  InvalidCredentialsError: 401,
  AccountStatusError: 403,
  DuplicateEntityError: 409,
  InvalidClientError: 401,
  InvalidGrantError: 400,
  PKCEVerificationError: 400,
  InvalidRedirectUriError: 400,
  InvalidScopeError: 400,
  BusinessRuleViolationError: 422,
};

/**
 * 判断错误是否为 Next.js 构建期（静态预渲染 / Partial Prerendering）的正常中断信号。
 * React 通过 Suspense 边界正确处理这类异常——它们不是真正的运行时错误。
 *
 * Next.js 16 通过 `digest` 属性标记动态函数 bailout，
 * 同时保留 message 中的描述文本作为回退信号。
 */
function isPrerenderingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if ('digest' in err) {
    const digest = String((err as Record<string, unknown>)['digest']);
    if (digest.startsWith('DYNAMIC_SERVER_USAGE') || digest.startsWith('BAILOUT_TO_CLIENT_SIDE_RENDERING')) {
      return true;
    }
  }
  return (
    err.message.includes('prerender') ||
    err.message.includes('Prerendering')
  );
}

/**
 * 将领域错误统一映射为 HTTP 语义
 *
 * @param err 捕获的异常对象
 * @returns 标准化的错误映射结果，可直接返回给客户端
 */
export function mapDomainError(err: unknown): ErrorMapping {
  if (isPrerenderingError(err)) {
    return { status: 500, error: COMMON_ERRORS.INTERNAL_ERROR, message: '服务器内部错误' };
  }

  if (err instanceof DomainError) {
    const status = ERROR_STATUS[err.constructor.name] ?? 400;
    return { status, error: err.code, message: err.message };
  }

  return { status: 500, error: COMMON_ERRORS.INTERNAL_ERROR, message: '服务器内部错误' };
}

/** 内部错误码 → OAuth 2.1 标准错误码映射（RFC 6749 §5.2） */
const OAUTH_ERROR_MAP: Record<string, string> = {
  [AUTH_ERRORS.INVALID_CLIENT]: 'invalid_client',
  [AUTH_ERRORS.INVALID_CODE]: 'invalid_grant',
  [AUTH_ERRORS.PKCE_VERIFICATION_FAILED]: 'invalid_grant',
  [AUTH_ERRORS.OAUTH_INVALID_REDIRECT_URI]: 'invalid_grant',
  INVALID_SCOPE: 'invalid_scope',
  [AUTH_ERRORS.UNSUPPORTED_GRANT_TYPE]: 'unsupported_grant_type',
};

/**
 * 将内部错误码映射为符合 RFC 6749 §5.2 的 OAuth 2.1 标准错误码
 *
 * 消除 token 端点中手写 if/else 分支映射，收敛到单一真相源。
 */
export function mapToOAuthError(internalError: string): string {
  return OAUTH_ERROR_MAP[internalError] ?? 'invalid_request';
}
