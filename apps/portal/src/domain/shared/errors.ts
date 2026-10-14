import { AUTH_ERRORS, COMMON_ERRORS, type ErrorCode } from '@auth-sso/contracts';

/**
 * 领域错误类型体系
 * 所有领域异常的根类型，Controller 层据此映射 HTTP 状态码
 */
export class DomainError extends Error {
  /**
   * 错误码 —— **闭合词汇表**里的值（`@auth-sso/contracts` 的 `ErrorCode`）。
   *
   * 2026-10-13 由裸 `string` 收窄（架构评审 R2 次级候选「错误码词汇表」）：
   * 此前 `InvalidScopeError` 直接 `super('INVALID_SCOPE')`，而该码**不在词汇表里**，
   * 却被映射表当键用、并原样流进了 API 响应。收窄后这类码在编译期即被拒。
   */
  constructor(
    public readonly code: ErrorCode,
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

/**
 * 业务规则违反错误。
 *
 * @param rule 人类可读的规则说明
 * @param code **具体业务码**，默认 `VALIDATION_ERROR`。
 *
 * 需要它的理由（2026-10-13，架构评审 R2 次级候选「根部门守卫」）：
 * contracts 里为每条实体规则都留了专属码（`DEPARTMENT_ERRORS.CANNOT_DELETE_ROOT`、
 * `CANNOT_DELETE_SELF` …），但实现一律抛通用码 ⇒ 客户端只能靠**解析消息**区分
 * "有子部门"/"有关联用户"/"是根部门"。默认参数让既有调用点零改动，
 * 同时新规则可以携带自己的码。
 */
export class BusinessRuleViolationError extends DomainError {
  constructor(rule: string, code: ErrorCode = COMMON_ERRORS.VALIDATION_ERROR) {
    super(code, rule);
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
  /**
   * @param code 必须是词汇表内的错误码（`AUTH_ERRORS.ACCOUNT_DISABLED` / `ACCOUNT_LOCKED` …）
   *   —— 此前是裸 `string`，测试里甚至传过**状态值** `'DISABLED'` 当错误码。
   */
  constructor(code: ErrorCode, message: string) {
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
    super(AUTH_ERRORS.INVALID_SCOPE, message);
  }
}
