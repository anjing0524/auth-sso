/**
 * 用户领域核心模型单元测试 (Functional TDD)
 * 
 * @req R2, R3, R12
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { toggleUserStatus, createUser, deleteUser, applyUserUpdate, User } from '../../src/domain/user/user';
import { BusinessRuleViolationError } from '../../src/domain/shared/errors';

describe('User 领域核心规则与工厂单元测试', () => {
  
  const now = Temporal.Now.instant();

  function createTestUser(status: 'ACTIVE' | 'DISABLED' | 'LOCKED' | 'DELETED'): User {
    return {
      id: 'usr_test_1',
      publicId: 'user_pub_test',
      username: 'test_user',
      email: 'test@example.com',
      name: '测试用户',
      status,
      deptId: 'dept_test_1',
      deptName: '测试部门',
      avatarUrl: null,
      createdAt: now,
    };
  }

  // 1. 工厂函数测试
  it('应当能够通过工厂函数创建出符合规格的 ACTIVE 状态初始用户', () => {
    const input = {
      name: '王小二',
      username: 'wangxiaoer',
      email: 'wang@example.com',
      password: 'secretpassword',
      deptId: 'dept_test_1',
    };
    
    // 模拟 ID 生成器以保证纯度
    const mockIdGenerator = (len: number) => {
      if (len === 20) return 'mocked_userid_20_chars';
      return 'mockedid';
    };

    const user = createUser(input, mockIdGenerator);
    
    expect(user.status).toBe('ACTIVE');
    expect(user.id).toBe('mocked_userid_20_chars');
    expect(user.publicId).toBe('user_mockedid');
    expect(user.username).toBe('wangxiaoer');
    expect(user.email).toBe('wang@example.com');
    expect(user.name).toBe('王小二');
    expect(user.deptId).toBe('dept_test_1');
    expect(user.createdAt).toBeInstanceOf(Temporal.Instant);
    // 验证 createdAt 时间接近当前时间（Temporal 不可变、精度纳秒级）
    expect(Temporal.Instant.compare(user.createdAt, Temporal.Now.instant())).toBeLessThanOrEqual(0);
  });

  // 2. 状态机切换规则测试
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

  // 3. 领域错误类型断言 —— 使用类型而非字符串匹配
  it('当已逻辑删除的用户 (DELETED) 切换状态时，必须抛出 BusinessRuleViolationError 拦截', () => {
    const user = createTestUser('DELETED');
    expect(() => toggleUserStatus(user)).toThrow(BusinessRuleViolationError);
  });

  // 4. 逻辑删除函数测试
  it('逻辑删除正常状态的用户，状态应当切换为 DELETED', () => {
    const user = createTestUser('ACTIVE');
    const result = deleteUser(user);
    expect(result.status).toBe('DELETED');
  });

  it('逻辑删除已被删除的用户，应当抛出 BusinessRuleViolationError 拦截', () => {
    const user = createTestUser('DELETED');
    expect(() => deleteUser(user)).toThrow(BusinessRuleViolationError);
  });

  // 5. 属性更新合并函数测试
  it('应当合并更新正常状态用户的属性', () => {
    const user = createTestUser('ACTIVE');
    const updated = applyUserUpdate(user, {
      name: '新姓名',
      email: 'newemail@example.com',
      status: 'DISABLED',
      deptId: 'new_dept_1'
    });
    expect(updated.name).toBe('新姓名');
    expect(updated.email).toBe('newemail@example.com');
    expect(updated.status).toBe('DISABLED');
    expect(updated.deptId).toBe('new_dept_1');
  });

  it('更新已逻辑删除的用户属性时，应当抛出 BusinessRuleViolationError 拦截', () => {
    const user = createTestUser('DELETED');
    expect(() => applyUserUpdate(user, { name: '新姓名' })).toThrow(BusinessRuleViolationError);
  });
});
