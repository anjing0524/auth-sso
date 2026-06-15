import 'server-only';

/**
 * 身份验证子模块 (Identity Verification)
 *
 * 职责：从当前请求解析出用户身份 (userId + JWT claims)。
 * 优先从 portal_jwt_token Cookie 中 JWKS 验签解析，
 * 失败时回退至 Better Auth 本地 Session 兜底（本地开发 / 直连场景）。
 *
 * 本模块只解决“你是谁”，不涉及“你能做什么”——后者见 check-permission.ts。
 *
 * @module lib/auth/verify-jwt
 */
import { NextRequest } from 'next/server';
import { getJwtFromCookie, verifyJwt, type PortalJwtClaims } from '../session';

/**
 * 身份解析结果
 */
export interface ResolvedIdentity {
  /** 用户内部唯一标识 ID */
  userId: string;
  /** JWT 验签后的完整声明；Session 回退模式下为 null */
  claims: PortalJwtClaims | null;
}

/**
 * 从当前请求解析用户身份
 *
 * 解析顺序：
 * 1. JWT Cookie 验签（无状态主链路，与 Gateway 对齐）
 * 2. Better Auth Session 兜底（本地直连 Portal 的场景）
 *
 * @param request NextRequest 或 Headers（Session 模式下用于读取请求头）
 * @returns 解析成功返回身份信息，未登录返回 null
 */
export async function resolveIdentity(
  request?: NextRequest | Headers
): Promise<ResolvedIdentity | null> {
  let userId: string | null = null;
  let claims: PortalJwtClaims | null = null;

  // 1. 尝试从 Cookie 中读取 JWT 并验签
  const token = await getJwtFromCookie();
  if (token) {
    claims = await verifyJwt(token);
    if (claims) {
      userId = claims.sub;
    }
  }

  // 2. 若无有效 JWT，回退 Better Auth 本地 Session 获取身份
  if (!userId) {
    const { auth } = await import('../auth'); // 动态导入避免循环依赖

    let headersInit: HeadersInit | undefined;
    if (request) {
      headersInit = request instanceof Headers ? request : request.headers;
    }

    const session = await auth.api.getSession({
      headers: headersInit || {},
    });
    if (session && session.user) {
      userId = session.user.id;
    }
  }

  if (!userId) {
    return null;
  }
  return { userId, claims };
}
