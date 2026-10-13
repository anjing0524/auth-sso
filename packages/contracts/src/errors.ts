/**
 * Auth-SSO 错误码定义
 * @module @auth-sso/contracts/errors
 */

// 错误码前缀
const ERROR_PREFIX = 'AUTH_SSO';

// 通用错误码 (1xxx)
export const COMMON_ERRORS = {
  UNKNOWN_ERROR: `${ERROR_PREFIX}_1000`,
  INVALID_REQUEST: `${ERROR_PREFIX}_1001`,
  UNAUTHORIZED: `${ERROR_PREFIX}_1002`,
  FORBIDDEN: `${ERROR_PREFIX}_1003`,
  NOT_FOUND: `${ERROR_PREFIX}_1004`,
  VALIDATION_ERROR: `${ERROR_PREFIX}_1005`,
  PAYLOAD_TOO_LARGE: `${ERROR_PREFIX}_1007`,
  INTERNAL_ERROR: `${ERROR_PREFIX}_1006`,
} as const;

// 认证错误码 (2xxx)
export const AUTH_ERRORS = {
  // 登录相关
  LOGIN_FAILED: `${ERROR_PREFIX}_2001`,
  INVALID_CREDENTIALS: `${ERROR_PREFIX}_2002`,
  ACCOUNT_DISABLED: `${ERROR_PREFIX}_2003`,
  ACCOUNT_LOCKED: `${ERROR_PREFIX}_2004`,
  ACCOUNT_NOT_FOUND: `${ERROR_PREFIX}_2005`,

  // Session 相关
  SESSION_EXPIRED: `${ERROR_PREFIX}_2010`,
  SESSION_INVALID: `${ERROR_PREFIX}_2011`,
  SESSION_NOT_FOUND: `${ERROR_PREFIX}_2012`,

  // Token 相关
  TOKEN_EXPIRED: `${ERROR_PREFIX}_2020`,
  TOKEN_INVALID: `${ERROR_PREFIX}_2021`,
  TOKEN_REVOKED: `${ERROR_PREFIX}_2022`,
  REFRESH_TOKEN_EXPIRED: `${ERROR_PREFIX}_2023`,
  REFRESH_TOKEN_INVALID: `${ERROR_PREFIX}_2024`,
  REFRESH_TOKEN_MISSING: `${ERROR_PREFIX}_2025`,

  // OIDC 相关
  INVALID_STATE: `${ERROR_PREFIX}_2030`,
  INVALID_NONCE: `${ERROR_PREFIX}_2031`,
  INVALID_CODE: `${ERROR_PREFIX}_2032`,
  /** OIDC 授权流程中 redirect_uri 不在白名单（区别于 Client 管理场景的 CLIENT_ERRORS.INVALID_REDIRECT_URI） */
  OAUTH_INVALID_REDIRECT_URI: `${ERROR_PREFIX}_2033`,
  PKCE_VERIFICATION_FAILED: `${ERROR_PREFIX}_2034`,
  INVALID_CLIENT: `${ERROR_PREFIX}_2035`,
  UNSUPPORTED_GRANT_TYPE: `${ERROR_PREFIX}_2036`,
  /** OAuth 授权请求的 scope 超出 Client 注册范围（RFC 6749 §4.1.2.1 `invalid_scope`） */
  INVALID_SCOPE: `${ERROR_PREFIX}_2037`,
} as const;

// 用户管理错误码 (3xxx)
export const USER_ERRORS = {
  USER_NOT_FOUND: `${ERROR_PREFIX}_3001`,
  USER_ALREADY_EXISTS: `${ERROR_PREFIX}_3002`,
  USERNAME_ALREADY_EXISTS: `${ERROR_PREFIX}_3003`,
  EMAIL_ALREADY_EXISTS: `${ERROR_PREFIX}_3004`,
  MOBILE_ALREADY_EXISTS: `${ERROR_PREFIX}_3005`,
  INVALID_PASSWORD: `${ERROR_PREFIX}_3006`,
  PASSWORD_TOO_WEAK: `${ERROR_PREFIX}_3007`,
  CANNOT_DELETE_SELF: `${ERROR_PREFIX}_3008`,
  CANNOT_DISABLE_SELF: `${ERROR_PREFIX}_3009`,
} as const;

// 部门管理错误码 (4xxx)
export const DEPARTMENT_ERRORS = {
  DEPARTMENT_NOT_FOUND: `${ERROR_PREFIX}_4001`,
  DEPARTMENT_ALREADY_EXISTS: `${ERROR_PREFIX}_4002`,
  DEPARTMENT_HAS_CHILDREN: `${ERROR_PREFIX}_4003`,
  DEPARTMENT_HAS_USERS: `${ERROR_PREFIX}_4004`,
  CANNOT_DELETE_ROOT: `${ERROR_PREFIX}_4005`,
  CANNOT_MOVE_TO_CHILD: `${ERROR_PREFIX}_4006`,
} as const;

// 角色管理错误码 (5xxx)
export const ROLE_ERRORS = {
  ROLE_NOT_FOUND: `${ERROR_PREFIX}_5001`,
  ROLE_ALREADY_EXISTS: `${ERROR_PREFIX}_5002`,
  CANNOT_DELETE_SYSTEM_ROLE: `${ERROR_PREFIX}_5003`,
  CANNOT_MODIFY_SYSTEM_ROLE: `${ERROR_PREFIX}_5004`,
} as const;

// 权限管理错误码 (6xxx)
export const PERMISSION_ERRORS = {
  PERMISSION_NOT_FOUND: `${ERROR_PREFIX}_6001`,
  PERMISSION_ALREADY_EXISTS: `${ERROR_PREFIX}_6002`,
  INSUFFICIENT_PERMISSIONS: `${ERROR_PREFIX}_6003`,
} as const;

// Client 管理错误码 (7xxx)
export const CLIENT_ERRORS = {
  CLIENT_NOT_FOUND: `${ERROR_PREFIX}_7001`,
  CLIENT_ALREADY_EXISTS: `${ERROR_PREFIX}_7002`,
  CLIENT_DISABLED: `${ERROR_PREFIX}_7003`,
  INVALID_REDIRECT_URI: `${ERROR_PREFIX}_7004`,
  SECRET_ROTATION_FAILED: `${ERROR_PREFIX}_7005`,
} as const;

/**
 * 全部错误码值的**闭合词汇表** —— 按分组派生，不手写第二份。
 *
 * ## 为什么需要它（2026-10-13，架构评审 R2 次级候选「错误码词汇表」）
 *
 * 本文件此前是"40 余个字符串常量的袋子"：**零行为**，且没有一个类型把这些值闭起来。
 * 消费端 `DomainError.code` 因而是裸 `string`，两张映射表也以 `string` 为键并在缺项时
 * 静默兜底（`?? 400` / `?? 'invalid_request'`）。后果是**词汇表外的码真的上网了**：
 * `apps/portal/src/domain/shared/errors.ts` 的 `InvalidScopeError` 直接
 * `super('INVALID_SCOPE')`，而 `INVALID_SCOPE` 在词汇表里根本不存在。
 *
 * 现在 `DomainError.code` 键入本联合 ⇒ 词汇表外的码在**编译期**就无法出现。
 *
 * @example
 * ```ts
 * const code: ErrorCode = AUTH_ERRORS.INVALID_CLIENT; // ✓
 * // const bad: ErrorCode = 'INVALID_SCOPE';          // ✗ 编译错误
 * ```
 */
export const ERROR_CODE_VALUES = [
  ...Object.values(COMMON_ERRORS),
  ...Object.values(AUTH_ERRORS),
  ...Object.values(USER_ERRORS),
  ...Object.values(DEPARTMENT_ERRORS),
  ...Object.values(ROLE_ERRORS),
  ...Object.values(PERMISSION_ERRORS),
  ...Object.values(CLIENT_ERRORS),
] as const;

/** 词汇表内的错误码（闭合联合）。词汇表外的字符串无法赋给它。 */
export type ErrorCode = (typeof ERROR_CODE_VALUES)[number];