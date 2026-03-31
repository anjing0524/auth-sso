/**
 * Auth-SSO OIDC 常量定义
 * @module @auth-sso/contracts/oidc
 */

// OIDC 端点路径
export const OIDC_ENDPOINTS = {
  // Better Auth 默认路径
  AUTHORIZE: '/oauth2/authorize',
  TOKEN: '/oauth2/token',
  USERINFO: '/oauth2/userinfo',
  INTROSPECT: '/oauth2/introspect',
  REGISTER: '/oauth2/register',

  // JWKS
  JWKS: '/api/jwks',

  // OIDC Discovery
  OPENID_CONFIGURATION: '/.well-known/openid-configuration',
} as const;

// OAuth 2.1 参数
export const OAUTH_PARAMS = {
  RESPONSE_TYPE: 'code',                    // 授权码模式
  CODE_CHALLENGE_METHOD: 'S256',            // PKCE 方法
  GRANT_TYPE_AUTHORIZATION_CODE: 'authorization_code',
  GRANT_TYPE_REFRESH_TOKEN: 'refresh_token',
} as const;

// OIDC Scope 定义
export const OIDC_SCOPES = {
  OPENID: 'openid',
  PROFILE: 'profile',
  EMAIL: 'email',
  OFFLINE_ACCESS: 'offline_access',
} as const;

// 默认支持的 Scope
export const DEFAULT_SCOPES = [
  OIDC_SCOPES.OPENID,
  OIDC_SCOPES.PROFILE,
  OIDC_SCOPES.EMAIL,
  OIDC_SCOPES.OFFLINE_ACCESS,
] as const;

// Scope 返回的 Claims
export const SCOPE_CLAIMS = {
  [OIDC_SCOPES.OPENID]: ['sub'],
  [OIDC_SCOPES.PROFILE]: ['name', 'picture', 'given_name', 'family_name'],
  [OIDC_SCOPES.EMAIL]: ['email', 'email_verified'],
  [OIDC_SCOPES.OFFLINE_ACCESS]: [],  // Refresh Token
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

// 授权码 Redis Key
export const AUTH_CODE_KEY = (code: string) => `idp:auth_code:${code}`;

// PKCE 验证数据
export interface PKCEData {
  code_challenge: string;
  code_challenge_method: string;
  client_id: string;
  redirect_uri: string;
  created_at: number;
  expires_at: number;
}

// PKCE 数据 Redis Key
export const PKCE_KEY = (code: string) => `idp:pkce:${code}`;