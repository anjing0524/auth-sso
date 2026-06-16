/**
 * Session Cookie 类型与常量定义
 *
 * @module lib/session/types
 */
import type { DataScopeType } from '@auth-sso/contracts';
import type { JWTPayload } from 'jose';

/** Access Token Cookie 名称（网关从此 Cookie 提取并验签） */
export const JWT_COOKIE_NAME = 'portal_jwt_token';

/** Refresh Token Cookie 名称（仅在 Portal BFF 内部读写，不透传到子服务） */
export const REFRESH_COOKIE_NAME = 'portal_refresh_token';

/**
 * Portal JWT 载荷声明（扩展自 JWTPayload）
 * 与 Portal（Better Auth OIDC Provider）签发的 Access Token claims 字段对齐
 */
export interface PortalJwtClaims extends JWTPayload {
  /** 用户唯一标识（格式：usr_xxxx） */
  sub: string;
  /** Token 签发者（Portal/OIDC Provider 地址） */
  iss: string;
  /** Token 目标受众（portal-client） */
  aud: string | string[];
  /** Token 唯一标识（用于 jti 黑名单撤销） */
  jti: string;
  /** 用户角色编码列表 */
  roles?: string[];
  /** 用户权限编码列表（登录时根据角色动态注入） */
  permissions?: string[];
  /** 用户所在部门 ID */
  deptId?: string;
  /** 数据访问范围类型 */
  dataScopeType?: DataScopeType;
}
