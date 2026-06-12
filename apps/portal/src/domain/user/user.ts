import { UserProps } from './types';

/**
 * 用户领域接口定义（纯数据结构，无 Class 负担，方便 Functional DDD）
 */
export interface User extends UserProps {}

/**
 * 核心领域纯函数：状态机切换规则
 * 
 * @param user 原始用户对象
 * @returns 状态更新后的新用户副本
 */
export function toggleUserStatus(user: User): User {
  if (user.status === 'DELETED') {
    throw new Error('已逻辑删除的用户无法操作状态');
  }
  const newStatus = user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
  return {
    ...user,
    status: newStatus as any
  };
}
