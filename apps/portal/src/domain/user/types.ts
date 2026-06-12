/**
 * 领域主键 Branded Types 定义，保障编译期强类型安全
 */
export type UserId = string & { readonly __brand: unique symbol };
export type DeptId = string & { readonly __brand: unique symbol };

/**
 * 类型安全转换器
 */
export const toUserId = (id: string) => id as UserId;
export const toDeptId = (id: string) => id as DeptId;

export type UserStatus = 'ACTIVE' | 'DISABLED' | 'LOCKED' | 'DELETED';

export interface UserProps {
  id: UserId;
  publicId: string;
  username: string;
  email: string;
  name: string;
  status: UserStatus;
  deptId: DeptId | null;
  deptName: string | null;
  createdAt: Date;
}
