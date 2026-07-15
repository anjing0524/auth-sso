/**
 * 认证领域类型定义 (Authentication Domain Types)
 *
 * 纯接口，零框架依赖。所有认证相关的 JWT Claims、输入参数、
 * Token 类型集中定义于此。
 *
 * @module domain/auth/types
 */
import type { JWTPayload } from 'jose';

// ────────────────────────────────────────────
// JWT Claims
// ────────────────────────────────────────────

/** Portal JWT Access Token 载荷声明 */
export interface PortalJwtClaims extends JWTPayload {
  /** 用户唯一标识（UUID 格式） */
  sub: string;
  /** Token 签发者 */
  iss: string;
  /** Token 目标受众 */
  aud: string | string[];
  /** Token 唯一标识（用于 jti 黑名单撤销） */
  jti: string;
}

/** Token 轮换结果 */
export interface RefreshTokenResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// ────────────────────────────────────────────
// 身份解析
// ────────────────────────────────────────────

/** 从 Gateway header 或 JWT Cookie 解析出的用户身份 */
export interface ResolvedIdentity {
  /** 用户内部唯一标识 ID */
  userId: string;
  /** JWT 完整声明（Gateway 路径下从 Cookie 快速解码，自验签路径下完整验证） */
  claims: PortalJwtClaims;
}

// ────────────────────────────────────────────
// 授权请求暂存（authorize 未登录 → Redis 暂存 OAuth params → 登录后恢复）
// ────────────────────────────────────────────

/**
 * 暂存的授权请求参数
 *
 * authorize 端点检测到未登录时，将 OAuth 授权请求参数序列化存入 Redis
 * （key=portal:auth_req:{session_id}，TTL 5min），/login URL 只暴露不透明的
 * session_id。用户登录后回跳 authorize 时，凭 session_id 从 Redis 恢复这些参数，
 * 避免敏感参数（code_challenge/state/nonce）泄露到 /login URL。
 */
export interface StoredAuthRequest {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  state: string;
  nonce?: string | null;
}
