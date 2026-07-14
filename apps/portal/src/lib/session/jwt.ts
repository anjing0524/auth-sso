import 'server-only';

/**
 * JWT 快速解码（不验签，仅用于提取载荷信息）
 *
 * 验签统一由 lib/auth/token.ts verifyAccessToken + resolveIdentity 负责。
 * unsafeDecodeJwtPayload 仅用于 revoke.ts 提取 jti/exp 等不需要验签的场景。
 *
 * @module lib/session/jwt
 */
import { decodeJwt } from 'jose';
import { type PortalJwtClaims } from '@/domain/auth/types';

/**
 * 快速解码 JWT 载荷（不验签！仅适用于已经过验签的 token）
 * ⚠️ 命名以 unsafe 前缀明确告知调用方：此函数不验签，不可在安全判断中使用。
 *
 * @param token JWT 字符串
 * @returns 载荷声明对象，解码失败则返回 null
 */
export function unsafeDecodeJwtPayload(token: string): PortalJwtClaims | null {
  try {
    return decodeJwt<PortalJwtClaims>(token);
  } catch {
    return null;
  }
}

/**
 * @deprecated since v3.2 — remove after 2026-10-14
 * 请使用 unsafeDecodeJwtPayload（显式标注不验签语义）
 */
export const decodeJwtPayload = unsafeDecodeJwtPayload;
