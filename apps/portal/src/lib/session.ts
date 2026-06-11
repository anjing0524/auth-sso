import 'server-only';

/**
 * Portal 无状态 JWT Cookie 工具库
 *
 * 架构说明（方案 A - 去中心化）：
 * - 不再使用 Redis Session 存储，用户身份直接由 portal_jwt_token Cookie 中的 JWT 携带
 * - Access Token → HttpOnly Cookie: portal_jwt_token
 * - Refresh Token → HttpOnly Cookie: portal_refresh_token（仅由 /api/auth/refresh 读取）
 * - 紧急踢人 → jti 黑名单存 Redis（TTL = Token 剩余有效期），比全量 Session 存储代价小得多
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { jwtVerify, createRemoteJWKSet, decodeJwt, type JWTPayload } from 'jose';
import { getRedis } from './redis';

// ────────────────────────────────────────────────────────────
// Cookie 常量配置
// ────────────────────────────────────────────────────────────

/** Access Token Cookie 名称（网关从此 Cookie 提取并验签） */
export const JWT_COOKIE_NAME = 'portal_jwt_token';

/** Refresh Token Cookie 名称（仅在 Portal BFF 内部读写，不透传到子服务） */
export const REFRESH_COOKIE_NAME = 'portal_refresh_token';

// ────────────────────────────────────────────────────────────
// JWT 声明类型（与 IdP 签发内容对齐）
// ────────────────────────────────────────────────────────────

/**
 * Portal JWT 载荷声明（扩展自 JWTPayload）
 * 与 IdP（Better Auth）签发的 Access Token claims 字段对齐
 */
export interface PortalJwtClaims extends JWTPayload {
  /** 用户唯一标识（格式：usr_xxxx） */
  sub: string;
  /** Token 签发者（idp 地址） */
  iss: string;
  /** Token 目标受众（portal-client） */
  aud: string | string[];
  /** Token 唯一标识（用于 jti 黑名单撤销） */
  jti: string;
  /** 用户角色编码列表 */
  roles?: string[];
  /** 用户权限编码列表（由 IdP 在登录时根据角色动态注入） */
  permissions?: string[];
  /** 用户所在部门 ID */
  deptId?: string;
  /** 数据访问范围类型 */
  dataScopeType?: 'ALL' | 'DEPT' | 'DEPT_AND_SUB' | 'SELF' | 'CUSTOM';
}

// ────────────────────────────────────────────────────────────
// JWKS 远端公钥集（jose 内部自动缓存 + 定期刷新）
// ────────────────────────────────────────────────────────────

/** 懒初始化的 JWKS 远端公钥集，用于验签 IdP 签发的 JWT */
let jwksSet: ReturnType<typeof createRemoteJWKSet> | null = null;

/**
 * 获取 JWKS 远端公钥集（单例模式）
 * jose 的 createRemoteJWKSet 内部维护缓存，自动处理 kid 匹配与刷新
 */
function getJwksSet() {
  if (!jwksSet) {
    const jwksUri = (process.env.IDP_JWKS_URI || 'http://localhost:4101/api/auth/.well-known/jwks').trim();
    jwksSet = createRemoteJWKSet(new URL(jwksUri));
  }
  return jwksSet;
}

// ────────────────────────────────────────────────────────────
// JWT Cookie 读写工具
// ────────────────────────────────────────────────────────────

/**
 * 将 Access Token 和 Refresh Token 分别写入 HttpOnly Cookie
 * 在 OIDC 回调成功后由 Portal BFF 调用
 *
 * @param response NextResponse 响应对象
 * @param accessToken IdP 签发的 JWT Access Token 字符串
 * @param refreshToken IdP 签发的 Refresh Token 字符串
 * @param accessTokenExpiresIn Access Token 有效期（秒），用于设置 Cookie maxAge
 */
export function setJwtCookies(
  response: NextResponse,
  accessToken: string,
  refreshToken: string | undefined,
  accessTokenExpiresIn: number = 3600
): void {
  const isProduction = process.env.NODE_ENV === 'production';

  // Access Token Cookie：网关读取并验签，下发给子微服务
  response.cookies.set(JWT_COOKIE_NAME, accessToken, {
    path: '/',
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: accessTokenExpiresIn,
  });

  // Refresh Token Cookie：仅用于 /api/auth/refresh，有效期固定 7 天
  if (refreshToken) {
    response.cookies.set(REFRESH_COOKIE_NAME, refreshToken, {
      path: '/api/auth/refresh', // 严格限制 path，防止 Refresh Token 泄露给其他路由
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 天
    });
  }
}

/**
 * 清除 Access Token 和 Refresh Token Cookie（登出时调用）
 *
 * @param response 响应对象（支持 NextResponse 或原生 Response）
 */
export function clearJwtCookies(response: Response): void {
  const expiredCookieBase = 'Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  response.headers.append('Set-Cookie', `${JWT_COOKIE_NAME}=; ${expiredCookieBase}`);
  response.headers.append(
    'Set-Cookie',
    `${REFRESH_COOKIE_NAME}=; Path=/api/auth/refresh; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

/**
 * 从当前请求的 Cookie 中读取 Access Token 字符串（服务端 Server Component / API Route 调用）
 * 注意：此函数必须在 Next.js 服务端环境（server-only）中调用
 *
 * @returns Access Token 字符串，若不存在则返回 null
 */
export async function getJwtFromCookie(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    return cookieStore.get(JWT_COOKIE_NAME)?.value ?? null;
  } catch (error) {
    console.error('[Session] Failed to read JWT cookie:', error);
    return null;
  }
}

/**
 * 从当前请求的 Cookie 中读取 Refresh Token 字符串
 *
 * @returns Refresh Token 字符串，若不存在则返回 null
 */
export async function getRefreshTokenFromCookie(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    return cookieStore.get(REFRESH_COOKIE_NAME)?.value ?? null;
  } catch (error) {
    console.error('[Session] Failed to read refresh token cookie:', error);
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// JWT 验证与解析
// ────────────────────────────────────────────────────────────

/**
 * 完整验签并解析 JWT（使用 JWKS 远端公钥，jose 内部缓存）
 * 适用于需要严格安全保证的场景（如 Portal API 路由鉴权）
 *
 * @param token JWT 字符串
 * @returns 验签通过后的载荷声明，验签失败则返回 null
 */
export async function verifyJwt(token: string): Promise<PortalJwtClaims | null> {
  try {
    const { payload } = await jwtVerify<PortalJwtClaims>(token, getJwksSet(), {
      issuer: (process.env.IDP_ISSUER || 'http://localhost:4101').trim(),
      // aud 根据环境配置，Portal 作为 OIDC Client 会收到 aud = clientId
      // 此处不强制校验 aud，由 IdP oidcProvider 自行处理（Better Auth 已在 token 端点做校验）
    });

    // 检查 jti 是否在黑名单（用于管理员紧急踢人场景）
    if (payload.jti && await isJtiRevoked(payload.jti)) {
      console.warn('[Session] JWT jti 已在黑名单中，拒绝访问:', payload.jti);
      return null;
    }

    return payload;
  } catch (error) {
    console.warn('[Session] JWT 验签失败:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * 快速解码 JWT 载荷（不验签，仅适用于已经过网关验签的场景，例如读取 userId 用于后续 DB 查询）
 * ⚠️ 不要在安全相关判断中使用此函数，必须确保 token 来源可信
 *
 * @param token JWT 字符串
 * @returns 载荷声明对象，解码失败则返回 null
 */
export function decodeJwtPayload(token: string): PortalJwtClaims | null {
  try {
    return decodeJwt<PortalJwtClaims>(token);
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// jti 黑名单（紧急撤销机制）
// ────────────────────────────────────────────────────────────

const JTI_BLOCKLIST_PREFIX = 'portal:jti_blocklist:';

/**
 * 将指定 jti 加入 Redis 黑名单，用于管理员紧急踢人/封禁账户
 * TTL 设置为 Token 的剩余有效期，避免 Redis 存储无限增长
 *
 * @param jti JWT 的唯一标识符
 * @param tokenExp JWT 的过期时间戳（秒级 Unix timestamp）
 */
export async function revokeJti(jti: string, tokenExp: number): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;
    const ttl = Math.max(tokenExp - Math.floor(Date.now() / 1000), 1);
    await redis.setex(`${JTI_BLOCKLIST_PREFIX}${jti}`, ttl, '1');
  } catch (error) {
    console.error('[Session] 写入 jti 黑名单失败:', error);
  }
}

/**
 * 检查 jti 是否已被撤销（在黑名单中）
 *
 * @param jti JWT 的唯一标识符
 * @returns 是否已被撤销
 */
export async function isJtiRevoked(jti: string): Promise<boolean> {
  try {
    const redis = getRedis();
    if (!redis) return false;
    const result = await redis.exists(`${JTI_BLOCKLIST_PREFIX}${jti}`);
    return result === 1;
  } catch (error) {
    console.error('[Session] 查询 jti 黑名单失败:', error);
    return false; // 查询失败时默认放行，避免误拦截
  }
}

/**
 * 撤销某个用户当前 JWT 的 jti（需要先解码获取 jti 和 exp）
 * 用于密码修改、账号封禁等需要强制下线的场景
 *
 * @param accessToken 用户当前的 Access Token JWT 字符串
 */
export async function revokeUserToken(accessToken: string): Promise<void> {
  const payload = decodeJwtPayload(accessToken);
  if (payload?.jti && payload.exp) {
    await revokeJti(payload.jti, payload.exp);
  }
}

// ────────────────────────────────────────────────────────────
// 向后兼容性导出（供 page.tsx / 其他尚未迁移的模块使用）
// ────────────────────────────────────────────────────────────

/**
 * @deprecated 已迁移至 JWT Cookie 架构，请使用 getJwtFromCookie()
 * 保留此函数签名以最小化迁移期间的破坏性影响
 */
export async function getSessionIdFromCookie(): Promise<string | null> {
  return getJwtFromCookie();
}