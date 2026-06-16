import 'server-only';

/**
 * JWT 验证与解析
 *
 * @module lib/session/jwt
 */
import { jwtVerify, decodeJwt } from 'jose';
import { getJwksSet } from './jwks';
import { type PortalJwtClaims } from './types';
import { isJtiRevoked } from './revoke';
import { getIssuer } from '@/lib/env';

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
      issuer: getIssuer(),
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
 * 快速解码 JWT 载荷（不验签，仅适用于已经过网关验签的场景）
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
