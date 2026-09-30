/**
 * Auth-SSO OIDC 常量定义
 * @module @auth-sso/contracts/oidc
 */

/** Portal Access Token 的 aud claim 值（与 Gateway 验签期望的 aud 一致） */
export const PORTAL_AUD = 'auth-sso' as const;

/**
 * Portal 自身作为 OAuth Client 的内部 client_id（BFF 模式）。
 *
 * ADR-013：OAuth AT 的 aud = 签发对象 client_id，Gateway/Portal 自身流程
 * 恒为该值——aud 验签预期与自身 client 身份是同一事实。
 */
export const PORTAL_CLIENT_ID = 'portal' as const;

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

/**
 * 授权码流程发放 Refresh Token 时的默认 scope 集合。
 *
 * 单一真相源：token.ts 签发默认值与 DB 列默认值均从此派生，禁止再手写字面量。
 */
export const DEFAULT_SCOPES = SCOPES_SUPPORTED.join(' ') as string;
export const ID_TOKEN_SIGNING_ALG_VALUES_SUPPORTED = ['ES256'] as const;
export const SUBJECT_TYPES_SUPPORTED = ['public'] as const;
export const CLAIMS_SUPPORTED = ['sub', 'iss', 'aud', 'exp', 'iat', 'jti', 'auth_time', 'nonce', 'name', 'preferred_username', 'email', 'email_verified', 'picture'] as const;

// Token 有效期 (秒)
export const TOKEN_TTL = {
  /** 登录会话 Token (5 分钟) */
  LOGIN_SESSION: 300,
  /** OAuth Access Token (1 小时) */
  ACCESS_TOKEN: 3600,
  /** OAuth Refresh Token (7 天) */
  REFRESH_TOKEN: 7 * 24 * 3600,
} as const;

/**
 * JWT 显式类型（RFC 8725 §3.11）— typ protected header 值。
 *
 * 同一签发密钥下的不同用途 JWT（Login Session / Access Token / ID Token）
 * 共享 claims 形状，显式 typ 防止跨用途类型混淆（如 login 凭证冒充 AT）。
 * 验签规则：typ 存在且不匹配预期即拒；缺失放行（存量 token 兼容期）。
 */
export const JWT_TYP = {
  /** OAuth Access Token */
  ACCESS_TOKEN: 'at+jwt',
  /** 登录会话临时凭证（authorize 冷登录桥接） */
  LOGIN_SESSION: 'login+jwt',
  /** OIDC ID Token */
  ID_TOKEN: 'id+jwt',
} as const;

/**
 * JWKS 密钥轮换窗口（秒）— 与 signing-keys.ts / jwks 端点共享的单一真相源。
 *
 * - RENEW_AHEAD：签名密钥到期前提前生成新对（业界惯例提前一天），避免过期瞬间才开始轮换
 * - PUBLISH_GRACE：过期公钥在 JWKS 端点保留的最短时长，须 ≥ max(AT_TTL, ID_TOKEN_TTL) +
 *   时钟偏移余量；否则轮换瞬间存量 token 对冷启动的验签方不可验证
 */
export const JWKS_RENEW_AHEAD_SECS = 24 * 3600;
export const JWKS_PUBLISH_GRACE_SECS = 2 * 3600;

// Redis Key 前缀（Portal ↔ Gateway 共享）
export const REDIS_KEY_PREFIX = {
  /** JTI 黑名单 Key 前缀 — Gateway + Portal 双重校验 */
  JTI_BLOCKLIST: 'portal:jti_blocklist:',
  /** 用户 → JTI 映射 Key 前缀 — Portal 维护 */
  USER_JTI: 'portal:user_jti:',
  /** 用户权限上下文缓存 Key 前缀 */
  USER_PERMS: 'portal:user_perms:',
  /** 授权请求参数暂存 Key 前缀 — authorize 未登录时存 OAuth params，登录后恢复（5min TTL） */
  AUTH_REQUEST: 'portal:auth_req:',
  /** 登录失败计数 Key 前缀 — 暴力破解防护 */
  LOGIN_FAIL: 'portal:login_fail:',
} as const;
