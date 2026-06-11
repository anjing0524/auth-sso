import 'server-only';

/**
 * Portal Session 管理
 * 使用 Redis 存储 Session，支持 idle timeout 和 absolute timeout
 * 全量包裹 try-catch 防御网，支持绝对时间过期物理清理，保障高可用性与数据一致性
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getRedis } from './redis';
import { generateId } from './crypto';

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
 *
 * @param params 创建 Session 所需的用户、Token和有效期参数
 * @returns 返回创建成功的 PortalSession 对象
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
    // 废止局部 generateId 函数，静态导入并复用全局统一的 crypto 工具，保障 DRY
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

  try {
    const redis = getRedis();
    const key = `${SESSION_CONFIG.keyPrefix}${session.id}`;

    // 存储 Session，设置与 absolute timeout 相同的 TTL
    await redis.setex(
      key,
      Math.ceil(SESSION_CONFIG.absoluteTimeoutMs / 1000),
      JSON.stringify(session)
    );

    // 建立用户在线会话的反向映射索引，用于管理员封禁、踢出等联动场景
    const userSessionKey = `portal:user_sessions:${session.userId}`;
    await redis.sadd(userSessionKey, session.id);
    // 设定与 absolute timeout 相同的 TTL，保障反向索引集合键在空闲时能自我销毁，避免悬空
    await redis.expire(userSessionKey, Math.ceil(SESSION_CONFIG.absoluteTimeoutMs / 1000));
  } catch (error) {
    // 防御性异常拦截：Redis 故障时不阻断主流程崩溃，详尽日志记录，降级处理
    console.error('[Session createSession] Failed to store session in Redis:', error);
  }

  return session;
}

/**
 * 获取 Session (同时检查 idle timeout 和 absolute timeout 并处理绝对过期物理清理)
 *
 * @param sessionId 会话唯一标识 ID
 * @returns 返回活跃的会话数据，若失效、过期或发生故障则返回 null
 */
export async function getSession(sessionId: string): Promise<PortalSession | null> {
  try {
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
  } catch (error) {
    // 防御性异常拦截：Redis 网络波动或不可用时，优雅返回 null，前台友好处理
    console.error('[Session getSession] Failed to retrieve session from Redis:', error);
    return null;
  }
}

/**
 * 更新 Session（更新最后访问时间，具备绝对过期边界物理清除防御）
 *
 * @param sessionId 会话唯一标识 ID
 */
export async function touchSession(sessionId: string): Promise<void> {
  try {
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
    } else {
      // 🔥已修复：绝对过期时间已到，执行物理清除防御，彻底根除分布式“僵尸悬空 Session”
      await redis.del(key);
    }
  } catch (error) {
    console.error('[Session touchSession] Failed to touch session in Redis:', error);
  }
}

/**
 * 更新 Session Token (具备绝对过期边界物理清除防御)
 *
 * @param sessionId 会话唯一标识 ID
 * @param params 全新 AccessToken、可选的 RefreshToken 以及过期时间
 */
export async function updateSessionToken(
  sessionId: string,
  params: {
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
  }
): Promise<void> {
  try {
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
    } else {
      // 🔥已修复：绝对过期时间已到，执行物理清除防御，彻底根除分布式“僵尸悬空 Session”
      await redis.del(key);
    }
  } catch (error) {
    console.error('[Session updateSessionToken] Failed to update session token in Redis:', error);
  }
}

/**
 * 删除 Session
 *
 * @param sessionId 会话唯一标识 ID
 */
export async function deleteSession(sessionId: string): Promise<void> {
  try {
    const redis = getRedis();
    const key = `${SESSION_CONFIG.keyPrefix}${sessionId}`;

    // 联动从反向映射集合中移出会话 ID，保障映射数据的高一致性
    const data = await redis.get(key);
    if (data) {
      const session: PortalSession = JSON.parse(data);
      const userSessionKey = `portal:user_sessions:${session.userId}`;
      await redis.srem(userSessionKey, sessionId);
    }

    await redis.del(key);
  } catch (error) {
    console.error('[Session deleteSession] Failed to delete session from Redis:', error);
  }
}

/**
 * 主动物理销毁某个用户的所有活跃 Session 会话
 * 用于用户禁用、停用、逻辑删除、密码重置等场景，保障全网实时踢出下线一致性
 *
 * @param userId 待踢出的用户唯一 ID
 */
export async function revokeUserSessions(userId: string): Promise<void> {
  try {
    const redis = getRedis();
    const userSessionKey = `portal:user_sessions:${userId}`;
    // 获取该用户关联的所有 sessionId 集合
    const sessionIds = await redis.smembers(userSessionKey);

    if (sessionIds.length > 0) {
      const pipeline = redis.pipeline();
      for (const sessionId of sessionIds) {
        const key = `${SESSION_CONFIG.keyPrefix}${sessionId}`;
        pipeline.del(key);
      }
      // 物理清除该用户反向 Set 本身
      pipeline.del(userSessionKey);
      await pipeline.exec();
      console.log(`[Session revokeUserSessions] Revoked ${sessionIds.length} sessions for user ${userId}`);
    }
  } catch (error) {
    console.error('[Session revokeUserSessions] Failed to revoke user sessions from Redis:', error);
  }
}


/**
 * 检查 Token 是否需要刷新
 *
 * @param session 当前活跃的 PortalSession 会话
 * @returns 返回布尔值代表是否需要重新进行令牌刷新
 */
export function shouldRefreshToken(session: PortalSession): boolean {
  const now = Date.now();
  return session.tokenExpiresAt - now < SESSION_CONFIG.tokenRefreshThresholdMs;
}

/**
 * 从 Cookie 获取 Session ID (适配 Next.js 15/16 异步 cookies)
 *
 * @returns 返回读取到的 Session ID，不存在则返回 null
 */
export async function getSessionIdFromCookie(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    return cookieStore.get(SESSION_CONFIG.cookieName)?.value || null;
  } catch (error) {
    console.error('[Session getSessionIdFromCookie] Failed to read cookies async:', error);
    return null;
  }
}

/**
 * 设置 Session Cookie
 *
 * @param response NextResponse 响应对象
 * @param sessionId 待写入 Cookie 的 Session ID
 */
export function setSessionCookie(response: NextResponse, sessionId: string): void {
  try {
    response.cookies.set(SESSION_CONFIG.cookieName, sessionId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: Math.ceil(SESSION_CONFIG.absoluteTimeoutMs / 1000),
      secure: process.env.NODE_ENV === 'production',
    });
  } catch (error) {
    console.error('[Session setSessionCookie] Failed to write session cookie:', error);
  }
}

/**
 * 清除 Session Cookie
 *
 * @param response 待清除 Cookie 的 Response 对象
 */
export function clearSessionCookie(response: Response): void {
  try {
    response.headers.append(
      'Set-Cookie',
      `${SESSION_CONFIG.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    );
  } catch (error) {
    console.error('[Session clearSessionCookie] Failed to clear session cookie:', error);
  }
}