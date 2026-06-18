import 'server-only';

/**
 * JWT 快速解码（不验签，仅用于提取载荷信息）
 *
 * 已废弃 verifyJwt——统一由 lib/auth/token.ts verifyAccessToken + resolveIdentity 替代。
 * decodeJwtPayload 仅用于 revoke.ts 提取 jti/exp。
 *
 * @module lib/session/jwt
 */
import { decodeJwt } from 'jose';
import { type PortalJwtClaims } from './types';

/**
 * 快速解码 JWT 载荷（不验签，仅适用于已经过验签的 token）
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
