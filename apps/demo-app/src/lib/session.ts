/**
 * Session 管理工具
 * 使用 Cookie 存储用户会话信息
 */
import { cookies } from 'next/headers';

export interface DemoSession {
  userId: string;
  email: string;
  name: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

const SESSION_COOKIE_NAME = 'demo_session';

/**
 * 从 Cookie 获取 Session
 */
export async function getSession(): Promise<DemoSession | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  if (!sessionCookie) {
    return null;
  }

  try {
    const session = JSON.parse(sessionCookie.value) as DemoSession;

    // 检查是否过期
    if (Date.now() > session.expiresAt) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

/**
 * 设置 Session Cookie
 */
export async function setSession(session: DemoSession): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, JSON.stringify(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 天
  });
}

/**
 * 清除 Session
 */
export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

/**
 * OAuth 临时状态存储
 * 用于存储 state、nonce、code_verifier 等
 */
export interface OAuthState {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirect?: string;
  createdAt: number;
}

const OAUTH_STATE_COOKIE_NAME = 'oauth_state';

/**
 * 保存 OAuth 状态
 */
export async function saveOAuthState(state: OAuthState): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(OAUTH_STATE_COOKIE_NAME, JSON.stringify(state), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10, // 10 分钟
  });
}

/**
 * 获取并清除 OAuth 状态
 */
export async function consumeOAuthState(): Promise<OAuthState | null> {
  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(OAUTH_STATE_COOKIE_NAME);

  if (!stateCookie) {
    return null;
  }

  // 立即删除，防止重放
  cookieStore.delete(OAUTH_STATE_COOKIE_NAME);

  try {
    const state = JSON.parse(stateCookie.value) as OAuthState;

    // 检查是否过期（10 分钟）
    if (Date.now() - state.createdAt > 10 * 60 * 1000) {
      return null;
    }

    return state;
  } catch {
    return null;
  }
}