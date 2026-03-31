/**
 * 权限上下文类型定义
 */
export interface PermissionContext {
  roles: string[];
  permissions: string[];
  dataScopeType: 'ALL' | 'DEPT' | 'DEPT_AND_SUB' | 'SELF' | 'CUSTOM';
  deptId?: string;
}

/**
 * 用户信息响应
 */
export interface UserInfoResponse {
  id: string;
  publicId: string;
  email: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED' | 'LOCKED';
  deptId?: string;
  deptName?: string;
  roles: Array<{
    id: string;
    code: string;
    name: string;
  }>;
}

/**
 * 部门信息响应
 */
export interface DepartmentResponse {
  id: string;
  publicId: string;
  name: string;
  code?: string;
  parentId?: string;
  sort: number;
  status: 'ACTIVE' | 'DISABLED';
}

/**
 * 角色信息响应
 */
export interface RoleResponse {
  id: string;
  publicId: string;
  name: string;
  code: string;
  description?: string;
  dataScopeType: 'ALL' | 'DEPT' | 'DEPT_AND_SUB' | 'SELF' | 'CUSTOM';
  isSystem: boolean;
  status: 'ACTIVE' | 'DISABLED';
}

/**
 * 权限信息响应
 */
export interface PermissionResponse {
  id: string;
  publicId: string;
  name: string;
  code: string;
  type: 'MENU' | 'API' | 'DATA';
  resource?: string;
  action?: string;
  parentId?: string;
  status: 'ACTIVE' | 'DISABLED';
}