import { AUTH_ERRORS, COMMON_ERRORS } from '@auth-sso/contracts';

/**
 * 领域错误类型体系
 * 所有领域异常的根类型，Controller 层据此映射 HTTP 状态码
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** 实体未找到错误 */
export class EntityNotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super(COMMON_ERRORS.NOT_FOUND, `${entity} [${id}] 不存在`);
  }
}

/** 业务规则违反错误 */
export class BusinessRuleViolationError extends DomainError {
  constructor(rule: string) {
    super(COMMON_ERRORS.VALIDATION_ERROR, rule);
  }
}

/** 唯一性冲突错误 */
export class DuplicateEntityError extends DomainError {
  constructor(entity: string, field: string) {
    super(COMMON_ERRORS.VALIDATION_ERROR, `${entity} 的 ${field} 已存在`);
  }
}

/** 无权限错误 */
export class ForbiddenError extends DomainError {
  constructor(message: string = '超出数据权限范围') {
    super(COMMON_ERRORS.FORBIDDEN, message);
  }
}

// ── 登录认证领域错误 ──

/** 登录凭据无效（用户名/邮箱不存在或密码错误，统一返回以防用户枚举） */
export class InvalidCredentialsError extends DomainError {
  constructor(message: string = '邮箱或密码错误') {
    super(AUTH_ERRORS.INVALID_CREDENTIALS, message);
  }
}

/** 账号状态异常（禁用/锁定/已删除），按具体 code 区分 */
export class AccountStatusError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message);
  }
}

// ── OAuth 2.1 领域错误 ──

/** OAuth Client 无效（不存在 / 已停用 / 密钥不匹配） */
export class InvalidClientError extends DomainError {
  constructor(message: string = 'Client 不存在或已停用') {
    super(AUTH_ERRORS.INVALID_CLIENT, message);
  }
}

/** 授权码无效（过期 / 已使用 / redirect_uri 不匹配） */
export class InvalidGrantError extends DomainError {
  constructor(message: string) {
    super(AUTH_ERRORS.INVALID_CODE, message);
  }
}

/** PKCE 验证失败（code_verifier 与 code_challenge 不匹配） */
export class PKCEVerificationError extends DomainError {
  constructor(message: string = 'PKCE 验证失败') {
    super(AUTH_ERRORS.PKCE_VERIFICATION_FAILED, message);
  }
}

/** OAuth redirect_uri 不在 Client 白名单中 */
export class InvalidRedirectUriError extends DomainError {
  constructor(message: string = '回调地址与应用注册的不匹配') {
    super(AUTH_ERRORS.OAUTH_INVALID_REDIRECT_URI, message);
  }
}

/** OAuth scope 不在 Client 注册允许范围内 */
export class InvalidScopeError extends DomainError {
  constructor(message: string = '请求的 scope 未获 Client 授权') {
    super('INVALID_SCOPE', message);
  }
}
