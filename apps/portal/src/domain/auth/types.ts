/**
 * 认证领域类型定义 (Authentication Domain Types)
 *
 * 纯接口，零框架依赖。所有认证相关的 JWT Claims、输入参数、
 * Token 类型集中定义于此。
 *
 * @module domain/auth/types
 */
import type { DataScopeType } from '@auth-sso/contracts';
import type { JWTPayload } from 'jose';

// ────────────────────────────────────────────
// JWT Claims
// ────────────────────────────────────────────

/** Portal JWT Access Token 载荷声明 */
export interface PortalJwtClaims extends JWTPayload {
  /** 用户唯一标识（public_id 格式） */
  sub: string;
  /** Token 签发者 */
  iss: string;
  /** Token 目标受众 */
  aud: string | string[];
  /** Token 唯一标识（用于 jti 黑名单撤销） */
  jti: string;
  /** 用户角色编码列表 */
  roles?: string[];
  /** 用户权限编码列表（登录时根据角色动态注入） */
  permissions?: string[];
  /** 用户所在部门 ID */
  deptId?: string;
  /** 数据访问范围类型 */
  dataScopeType?: DataScopeType;
}

/** OIDC ID Token 标准 Claims */
export interface IDTokenClaims extends JWTPayload {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  auth_time?: number;
  nonce?: string;
  at_hash?: string;
  c_hash?: string;
  name?: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
}

// ────────────────────────────────────────────
// 输入参数
// ────────────────────────────────────────────

/** 登录请求 */
export interface LoginInput {
  email: string;
  password: string;
}

/** Token 轮换请求 */
export interface RefreshTokenInput {
  refreshToken: string;
}

/** Token 轮换结果 */
export interface RefreshTokenResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** OAuth 2.1 授权请求参数 */
export interface AuthorizationRequest {
  client_id: string;
  redirect_uri: string;
  response_type: 'code';
  scope: string;
  state: string;
  nonce?: string;
  code_challenge: string;
  code_challenge_method: 'S256';
}

/** Token 端点请求 */
export interface TokenRequest {
  grant_type: 'authorization_code' | 'refresh_token';
  code?: string;
  redirect_uri?: string;
  code_verifier?: string;
  refresh_token?: string;
  client_id: string;
  client_secret?: string;
}

/** Token 端点响应 */
export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

// ────────────────────────────────────────────
// 身份解析
// ────────────────────────────────────────────

/** 从 Gateway header 或 JWT Cookie 解析出的用户身份 */
export interface ResolvedIdentity {
  /** 用户内部唯一标识 ID */
  userId: string;
  /** JWT 验签后的完整声明（Gateway 信任路径时为 null） */
  claims: PortalJwtClaims | null;
}
