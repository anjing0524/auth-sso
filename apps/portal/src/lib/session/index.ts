/**
 * Session 模块统一入口
 *
 * 实现已拆分为职责单一的子模块：
 * - types   — PortalJwtClaims 类型 + COOKIE_NAMES 常量
 * - cookies — Cookie 读写 (setJwtCookies / getJwtFromCookie 等)
 * - jwt     — JWT 快速解码 (decodeJwtPayload)
 * - revoke  — jti 黑名单紧急撤销
 *
 * @module lib/session
 */
export { type PortalJwtClaims } from './types';
export { setJwtCookies, clearJwtCookies, getJwtFromCookie, getRefreshTokenFromCookie } from './cookies';
export { decodeJwtPayload } from './jwt';
export { revokeJti, isJtiRevoked, revokeUserToken, trackUserJti, revokeUserAccessByUserId } from './revoke';
