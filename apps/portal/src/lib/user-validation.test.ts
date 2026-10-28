import { describe, expect, it } from 'vitest';
import { validateUserBasics } from './user-validation';

describe('validateUserBasics', () => {
  it('必填与长度', () => {
    expect(validateUserBasics({ name: '', email: '' })).toEqual({
      name: '显示名称不能为空',
      email: '电子邮箱不能为空',
    });
    expect(validateUserBasics({ name: 'a'.repeat(101), email: 'a@b' }).name).toContain('最多 100');
    expect(validateUserBasics({ name: 'a', email: `${'a'.repeat(255)}@b` }).email).toContain('最多 255');
  });

  it('邮箱形状', () => {
    expect(validateUserBasics({ name: 'a', email: 'not-an-email' }).email).toBe('电子邮箱格式不正确');
    expect(validateUserBasics({ name: 'a', email: 'a@b' })).toEqual({});
  });
});
