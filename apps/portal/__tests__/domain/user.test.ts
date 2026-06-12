/**
 * 用户领域核心模型单元测试 (Functional TDD)
 * 
 * @req R2, R3, R12
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { toggleUserStatus, User } from '../../src/domain/user/user';
import { toUserId, toDeptId } from '../../src/domain/user/types';

describe('User 领域核心规则状态机单元测试', () => {
  
  function createTestUser(status: 'ACTIVE' | 'DISABLED' | 'LOCKED' | 'DELETED'): User {
    return {
      id: toUserId('usr_test_1'),
      publicId: 'user_pub_test',
      username: 'test_user',
      email: 'test@example.com',
      name: '测试用户',
      status: status,
      deptId: toDeptId('dept_test_1'),
      deptName: '测试部门',
      createdAt: new Date()
    };
  }

  it('当激活态用户 (ACTIVE) 切换状态时，应当转为禁用态 (DISABLED)', () => {
    const user = createTestUser('ACTIVE');
    const result = toggleUserStatus(user);
    expect(result.status).toBe('DISABLED');
  });

  it('当禁用态用户 (DISABLED) 切换状态时，应当恢复为激活态 (ACTIVE)', () => {
    const user = createTestUser('DISABLED');
    const result = toggleUserStatus(user);
    expect(result.status).toBe('ACTIVE');
  });

  it('当已逻辑删除的用户 (DELETED) 切换状态时，必须抛出 Error 拦截', () => {
    const user = createTestUser('DELETED');
    expect(() => toggleUserStatus(user)).toThrow('已逻辑删除的用户无法操作状态');
  });
});
