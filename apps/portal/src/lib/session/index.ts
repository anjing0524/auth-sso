/**
 * Session 模块统一入口
 *
 * 实现已拆分为职责单一的子模块：
 * - types   — 常量 (JWT_COOKIE_NAME 等) + PortalJwtClaims
 * - cookies — Cookie 读写 (setJwtCookies / getJwtFromCookie 等)
 * - jwt     — JWT 快速解码 (decodeJwtPayload)
 * - revoke  — jti 黑名单紧急撤销
 *
 * @module lib/session
 */
export { JWT_COOKIE_NAME, REFRESH_COOKIE_NAME, type PortalJwtClaims } from './types';
export { setJwtCookies, clearJwtCookies, getJwtFromCookie, getRefreshTokenFromCookie } from './cookies';
export { decodeJwtPayload } from './jwt';
export { revokeJti, isJtiRevoked, revokeUserToken, getSessionIdFromCookie } from './revoke';
