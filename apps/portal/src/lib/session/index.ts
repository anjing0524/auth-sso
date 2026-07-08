/**
 * Session 模块统一入口
 *
 * 实现已拆分为职责单一的子模块：
 * - types              — PortalJwtClaims 类型 + COOKIE_NAMES 常量
 * - cookies            — Cookie 读写 (setJwtCookies / getJwtFromCookie 等)
 * - jwt                — JWT 快速解码 (decodeJwtPayload)
 * - revoke             — jti 黑名单紧急撤销
 * - auth-request-store — authorize 授权请求参数暂存（Redis）
 *
 * @module lib/session
 */
export { type PortalJwtClaims, type StoredAuthRequest } from '@/domain/auth/types';
export { setJwtCookies, clearJwtCookies, getJwtFromCookie, getRefreshTokenFromCookie } from './cookies';
export { decodeJwtPayload } from './jwt';
export { revokeJti, isJtiRevoked, revokeUserToken, trackUserJti, revokeUserAccessByUserId } from './revoke';
export {
  storeAuthRequest,
  getStoredAuthRequest,
  deleteStoredAuthRequest,
  generateSessionId,
} from './auth-request-store';
