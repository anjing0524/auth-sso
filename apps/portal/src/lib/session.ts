/**
 * Portal Session 管理
 * 使用 Redis 存储 Session，支持 idle timeout 和 absolute timeout
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getRedis } from './redis';
import { randomBytes } from 'crypto';

/**
 * 生成随机 ID
 */
function generateId(length: number = 32): string {
  return randomBytes(length).toString('hex');
}

/**
 * Session 数据结构
 */
export interface PortalSession {
  id: string;                    // Session ID
  userId: string;                // 用户 ID
  accessToken: string;           // IdP access token
  refreshToken?: string;         // IdP refresh token
  tokenExpiresAt: number;        // Token 过期时间戳 (毫秒)

  // 时间控制
  createdAt: number;             // Session 创建时间
  lastAccessAt: number;          // 最后访问时间
  absoluteExpiresAt: number;     // 绝对过期时间

  // 用户信息缓存
  userInfo?: {
    email: string;
    name: string;
    picture?: string;
  };
}

/**
 * Session 配置
 */
export const SESSION_CONFIG = {
  // Session Key 前缀
  keyPrefix: 'portal:session:',

  // Idle timeout (30 分钟)
  idleTimeoutMs: parseInt(process.env.SESSION_IDLE_TIMEOUT_MS || '1800000', 10),

  // Absolute timeout (7 天)
  absoluteTimeoutMs: parseInt(process.env.SESSION_ABSOLUTE_TIMEOUT_MS || '604800000', 10),

  // Access token 即将过期阈值 (5 分钟)
  tokenRefreshThresholdMs: parseInt(process.env.TOKEN_REFRESH_THRESHOLD_MS || '300000', 10),

  // Cookie 名称
  cookieName: 'portal_session_id',
};

/**
 * 创建新 Session
 */
export async function createSession(params: {
  userId: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  userInfo?: PortalSession['userInfo'];
}): Promise<PortalSession> {
  const now = Date.now();
  const session: PortalSession = {
    id: generateId(32),
    userId: params.userId,
    accessToken: params.accessToken,
    refreshToken: params.refreshToken,
    tokenExpiresAt: now + params.expiresIn * 1000,
    createdAt: now,
    lastAccessAt: now,
    absoluteExpiresAt: now + SESSION_CONFIG.absoluteTimeoutMs,
    userInfo: params.userInfo,
  };

  const redis = getRedis();
  const key = `${SESSION_CONFIG.keyPrefix}${session.id}`;

  // 存储 Session，设置与 absolute timeout 相同的 TTL
  await redis.setex(
    key,
    Math.ceil(SESSION_CONFIG.absoluteTimeoutMs / 1000),
    JSON.stringify(session)
  );

  return session;
}

/**
 * 获取 Session
 * 同时检查 idle timeout 和 absolute timeout
 */
export async function getSession(sessionId: string): Promise<PortalSession | null> {
  const redis = getRedis();
  const key = `${SESSION_CONFIG.keyPrefix}${sessionId}`;

  const data = await redis.get(key);
  if (!data) {
    return null;
  }

  const session: PortalSession = JSON.parse(data);
  const now = Date.now();

  // 检查 absolute timeout
  if (now >= session.absoluteExpiresAt) {
    await deleteSession(sessionId);
    return null;
  }

  // 检查 idle timeout
  if (now - session.lastAccessAt > SESSION_CONFIG.idleTimeoutMs) {
    await deleteSession(sessionId);
    return null;
  }

  return session;
}

/**
 * 更新 Session（更新最后访问时间）
 */
export async function touchSession(sessionId: string): Promise<void> {
  const redis = getRedis();
  const key = `${SESSION_CONFIG.keyPrefix}${sessionId}`;

  const data = await redis.get(key);
  if (!data) {
    return;
  }

  const session: PortalSession = JSON.parse(data);
  session.lastAccessAt = Date.now();

  // 计算剩余 TTL
  const ttl = Math.ceil((session.absoluteExpiresAt - Date.now()) / 1000);
  if (ttl > 0) {
    await redis.setex(key, ttl, JSON.stringify(session));
  }
}

/**
 * 更新 Session Token
 */
export async function updateSessionToken(
  sessionId: string,
  params: {
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
  }
): Promise<void> {
  const redis = getRedis();
  const key = `${SESSION_CONFIG.keyPrefix}${sessionId}`;

  const data = await redis.get(key);
  if (!data) {
    return;
  }

  const session: PortalSession = JSON.parse(data);
  session.accessToken = params.accessToken;
  if (params.refreshToken) {
    session.refreshToken = params.refreshToken;
  }
  session.tokenExpiresAt = Date.now() + params.expiresIn * 1000;
  session.lastAccessAt = Date.now();

  const ttl = Math.ceil((session.absoluteExpiresAt - Date.now()) / 1000);
  if (ttl > 0) {
    await redis.setex(key, ttl, JSON.stringify(session));
  }
}

/**
 * 删除 Session
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const redis = getRedis();
  const key = `${SESSION_CONFIG.keyPrefix}${sessionId}`;
  await redis.del(key);
}

/**
 * 检查 Token 是否需要刷新
 */
export function shouldRefreshToken(session: PortalSession): boolean {
  const now = Date.now();
  return session.tokenExpiresAt - now < SESSION_CONFIG.tokenRefreshThresholdMs;
}

/**
 * 从 Cookie 获取 Session ID
 */
export async function getSessionIdFromCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_CONFIG.cookieName)?.value || null;
}

/**
 * 设置 Session Cookie
 */
export function setSessionCookie(response: NextResponse, sessionId: string): void {
  response.cookies.set(SESSION_CONFIG.cookieName, sessionId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: Math.ceil(SESSION_CONFIG.absoluteTimeoutMs / 1000),
    secure: process.env.NODE_ENV === 'production',
  });
}

/**
 * 清除 Session Cookie
 */
export function clearSessionCookie(response: Response): void {
  response.headers.append(
    'Set-Cookie',
    `${SESSION_CONFIG.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}