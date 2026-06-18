/**
 * 认证领域类型定义 (Authentication Domain Types)
 *
 * 纯接口，零框架依赖。所有认证相关的 JWT Claims、输入参数、
 * Token 类型集中定义于此。
 *
 * @module domain/auth/types
 */
import type { DataScopeType } from '@auth-sso/contracts';
import type { JWTPayload } from 'jose';

// ────────────────────────────────────────────
// JWT Claims
// ────────────────────────────────────────────

/** Portal JWT Access Token 载荷声明 */
export interface PortalJwtClaims extends JWTPayload {
  /** 用户唯一标识（public_id 格式） */
  sub: string;
  /** Token 签发者 */
  iss: string;
  /** Token 目标受众 */
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

/** Token 轮换结果 */
export interface RefreshTokenResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// ────────────────────────────────────────────
// 身份解析
// ────────────────────────────────────────────

/** 从 Gateway header 或 JWT Cookie 解析出的用户身份 */
export interface ResolvedIdentity {
  /** 用户内部唯一标识 ID */
  userId: string;
  /** JWT 验签后的完整声明（Gateway 信任路径时为 null） */
  claims: PortalJwtClaims | null;
}
