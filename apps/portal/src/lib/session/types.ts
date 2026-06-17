/**
 * Session Cookie 类型与常量定义
 *
 * @module lib/session/types
 */
export { type PortalJwtClaims } from '@/domain/auth/types';

/** Access Token Cookie 名称（网关从此 Cookie 提取并验签） */
export const JWT_COOKIE_NAME = 'portal_jwt_token';

/** Refresh Token Cookie 名称（仅在 Portal BFF 内部读写，不透传到子服务） */
export const REFRESH_COOKIE_NAME = 'portal_refresh_token';
