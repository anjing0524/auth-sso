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
  /** Token 目标受众（AT/ID Token = 签发对象 client_id；LoginSession = 体系级 auth-sso，ADR-013） */
  aud: string | string[];
  /** 签发该 AT 的 OAuth client（与 aud 同源同值；供 revoke 归属判定与 introspect 透传，ADR-013） */
  client_id?: string;
  /** Token 唯一标识（用于 jti 黑名单撤销） */
  jti: string;
  /** OAuth 已授予 scope（空格分隔） */
  scope?: string;
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

/**
 * 从 Gateway header 或 JWT Cookie 解析出的用户身份
 *
 * 只暴露 `userId`，**不带 claims**——见 ADR-016：这条路径上 claims 曾经
 * 是一个用空字符串哨兵值伪造的 `PortalJwtClaims`（`iss`/`aud`/`jti` 均为 `''`，
 * 而类型声称非空），把"字段可能不存在"的负担推给了调用方。
 *
 * 实测该字段在全部生产代码中只有两个消费者：一个读 `claims.sub`（恒等于
 * `userId`），一个读 `exp`/`iat`（现由本类型的两个显式字段承担）。
 * 即 claims 对象本身从未被真正需要。
 * 需要 claims 的场景（aud 复核等）在 `lib/auth/verify-jwt.ts` 内部完成，
 * 不越过这个 seam。
 */
export interface ResolvedIdentity {
  /** 用户内部唯一标识 ID */
  userId: string;
  /**
   * Access Token 过期时间（epoch 秒），无法确定时为 null。
   *
   * 显式给出而非让调用方从 claims 里挖 `exp`——见 ADR-016。
   * 注意来源差异：Gateway 信任路径下 token 已由 Gateway 完成 ES256 验签与
   * jti 复核，此处仅解码取其时间字段；自验签路径下由 `jose` 完整校验后取值。
   */
  expiresAt: number | null;
  /** Access Token 签发时间（epoch 秒），无法确定时为 null */
  issuedAt: number | null;
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
