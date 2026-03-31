/**
 * Auth-SSO 共享类型定义
 * @module @auth-sso/contracts
 */

// 用户状态
export type UserStatus = 'ACTIVE' | 'DISABLED' | 'LOCKED';

// 部门/角色/权限/菜单/Client 状态
export type EntityStatus = 'ACTIVE' | 'DISABLED';

// 数据范围类型
export type DataScopeType = 'ALL' | 'DEPT' | 'DEPT_AND_SUB' | 'SELF' | 'CUSTOM';

// 权限类型
export type PermissionType = 'MENU' | 'API' | 'DATA';

// Client 类型
export type ClientType = 'confidential' | 'public';

// Grant Type
export type GrantType = 'authorization_code' | 'refresh_token';

// OIDC Scope
export type OIDCScope = 'openid' | 'profile' | 'email' | 'offline_access';

// Token 类型
export type TokenType = 'Bearer';

// 登录事件类型
export type LoginEventType = 'LOGIN_SUCCESS' | 'LOGIN_FAILED' | 'LOGOUT';

// 用户身份源
export type IdentityProvider = 'password';

// 外部 ID 前缀
export const PUBLIC_ID_PREFIX = {
  USER: 'u_',
  DEPARTMENT: 'd_',
  ROLE: 'r_',
  PERMISSION: 'p_',
  MENU: 'm_',
  CLIENT: 'c_',
} as const;

// 用户基础信息
export interface UserBase {
  id: string;          // public_id
  username: string;
  name: string;
  email?: string;
  mobile?: string;
  status: UserStatus;
  deptId?: string;
  avatarUrl?: string;
}

// 部门基础信息
export interface DepartmentBase {
  id: string;
  parentId?: string;
  name: string;
  code?: string;
  status: EntityStatus;
}

// 角色基础信息
export interface RoleBase {
  id: string;
  name: string;
  code: string;
  dataScope: DataScopeType;
  status: EntityStatus;
  isSystem: boolean;
}

// 权限基础信息
export interface PermissionBase {
  id: string;
  code: string;
  name: string;
  type: PermissionType;
  resource?: string;
  action?: string;
  status: EntityStatus;
}

// 菜单基础信息
export interface MenuBase {
  id: string;
  parentId?: string;
  name: string;
  path?: string;
  icon?: string;
  visible: boolean;
  status: EntityStatus;
}

// Client 基础信息
export interface ClientBase {
  id: string;
  name: string;
  clientId: string;
  clientType: ClientType;
  homepageUrl?: string;
  status: EntityStatus;
}

// 权限上下文
export interface PermissionContext {
  roles: string[];
  permissions: string[];
  menus: string[];
  dataScope: DataScopeType;
  dataScopeDepts?: string[];
}

// Session 信息
export interface SessionInfo {
  sessionId: string;
  userPublicId: string;
  userInternalId: string;
  createdAt: number;
  lastAccessAt: number;
  absoluteExpiresAt: number;
  idleTimeoutSec: number;
}

// Portal Session 扩展信息
export interface PortalSessionInfo extends SessionInfo {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  ip?: string;
  userAgent?: string;
}

// IdP Session 信息
export interface IdPSessionInfo extends SessionInfo {
  subject: string;
}

// OIDC Token 响应
export interface TokenResponse {
  access_token: string;
  token_type: TokenType;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

// OIDC UserInfo 响应
export interface UserInfoResponse {
  sub: string;
  name?: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
}

// 导出所有类型
export * from './errors';
export * from './permissions';
export * from './oidc';