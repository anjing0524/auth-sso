/**
 * Auth-SSO OIDC 常量定义
 * @module @auth-sso/contracts/oidc
 */

// OAuth 2.1 参数
export const OAUTH_PARAMS = {
  GRANT_TYPE_AUTHORIZATION_CODE: 'authorization_code',
  GRANT_TYPE_REFRESH_TOKEN: 'refresh_token',
} as const;

// OIDC Discovery 常量（单一真相源，供 .well-known/openid-configuration 和 DB enum 派生）
export const RESPONSE_TYPES_SUPPORTED = ['code'] as const;
export const GRANT_TYPES_SUPPORTED = ['authorization_code', 'refresh_token'] as const;
export const TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED = ['client_secret_basic', 'client_secret_post', 'none'] as const;
export const CODE_CHALLENGE_METHODS_SUPPORTED = ['S256'] as const;
export const SCOPES_SUPPORTED = ['openid', 'profile', 'email', 'offline_access'] as const;
export const ID_TOKEN_SIGNING_ALG_VALUES_SUPPORTED = ['ES256'] as const;
export const SUBJECT_TYPES_SUPPORTED = ['public'] as const;
export const CLAIMS_SUPPORTED = ['sub', 'iss', 'aud', 'exp', 'iat', 'jti', 'auth_time', 'nonce', 'name', 'preferred_username', 'email', 'email_verified', 'picture'] as const;

// OIDC Scope 定义
export const OIDC_SCOPES = {
  OPENID: 'openid',
  PROFILE: 'profile',
  EMAIL: 'email',
  OFFLINE_ACCESS: 'offline_access',
} as const;

// Token 有效期 (秒)
export const TOKEN_TTL = {
  /** 登录会话 Token (5 分钟) */
  LOGIN_SESSION: 300,
  /** OAuth Access Token (1 小时) */
  ACCESS_TOKEN: 3600,
  /** OAuth Refresh Token (7 天) */
  REFRESH_TOKEN: 7 * 24 * 3600,
} as const;

// Redis Key 前缀（Portal ↔ Gateway 共享）
export const REDIS_KEY_PREFIX = {
  /** JTI 黑名单 Key 前缀 — Gateway + Portal 双重校验 */
  JTI_BLOCKLIST: 'portal:jti_blocklist:',
  /** 用户 → JTI 映射 Key 前缀 — Portal 维护 */
  USER_JTI: 'portal:user_jti:',
  /** 授权码 Key 前缀 */
  AUTH_CODE: 'portal:auth_code:',
  /** PKCE 验证数据 Key 前缀 */
  PKCE: 'portal:pkce:',
  /** 用户权限上下文缓存 Key 前缀 */
  USER_PERMS: 'portal:user_perms:',
  /** 授权请求参数暂存 Key 前缀 — authorize 未登录时存 OAuth params，登录后恢复（5min TTL） */
  AUTH_REQUEST: 'portal:auth_req:',
  /** 续签去重 Key 前缀 — Gateway refresh 端点防并发重复续签 */
  REFRESH_DEDUP: 'portal:refresh_dedup:',
  /** 登录失败计数 Key 前缀 — 暴力破解防护 */
  LOGIN_FAIL: 'portal:login_fail:',
} as const;

// ID Token 标准 Claims
export interface IDTokenClaims {
  iss: string;              // Issuer
  sub: string;              // Subject (用户标识)
  aud: string;              // Audience (Client ID)
  exp: number;              // Expiration Time
  iat: number;              // Issued At
  auth_time?: number;       // Authentication Time
  nonce?: string;           // Nonce
  at_hash?: string;         // Access Token Hash
  c_hash?: string;          // Code Hash

  // Profile Claims
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;

  // Email Claims
  email?: string;
  email_verified?: boolean;
}

// Access Token Payload
export interface AccessTokenPayload {
  sub: string;              // Subject
  client_id: string;        // Client ID
  scope: string;            // Scope
  exp: number;              // Expiration
  iat: number;              // Issued At
  jti?: string;             // JWT ID
}

// 授权请求参数
export interface AuthorizationRequest {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  scope: string;
  state: string;
  nonce?: string;
  code_challenge: string;
  code_challenge_method: string;
  prompt?: 'none' | 'login' | 'consent' | 'select_account';
}

// Token 请求参数
export interface TokenRequest {
  grant_type: string;
  code?: string;
  redirect_uri?: string;
  code_verifier?: string;
  refresh_token?: string;
  client_id?: string;
  client_secret?: string;
}

// Introspect 请求参数
export interface IntrospectRequest {
  token: string;
  token_type_hint?: 'access_token' | 'refresh_token';
}

// Introspect 响应
export interface IntrospectResponse {
  active: boolean;
  scope?: string;
  client_id?: string;
  username?: string;
  token_type?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
  sub?: string;
  aud?: string;
  iss?: string;
  jti?: string;
}

// PKCE 验证数据
export interface PKCEData {
  code_challenge: string;
  code_challenge_method: string;
  client_id: string;
  redirect_uri: string;
  created_at: number;
  expires_at: number;
}


