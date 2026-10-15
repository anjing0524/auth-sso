/**
 * `toDashboardUser` 直测（空用户 / 有用户 / 字段为 null 三种输入）
 *
 * 这条映射此前是 `layout.tsx` 里 JSX 属性中的五个 `??` 链——只被"页面能渲染"间接覆盖。
 * 抽出来之后可以直接钉住兜底规则。
 */
import { describe, expect, it } from 'vitest';
import { toDashboardUser } from './dashboard-user';

describe('toDashboardUser', () => {
  it('读不到用户时：id 回落到身份里的 userId，name 兜「未知」，其余兜 null', () => {
    expect(toDashboardUser(null, 'identity-user-id')).toEqual({
      id: 'identity-user-id',
      email: null,
      name: '未知',
      picture: null,
      emailVerified: null,
    });
    expect(toDashboardUser(undefined, 'identity-user-id').id).toBe('identity-user-id');
  });

  it('读到用户时：逐字段透传，并把 avatarUrl 映射为 picture', () => {
    const user = {
      id: 'u-1',
      email: 'a@b.c',
      name: '张三',
      avatarUrl: 'https://cdn/a.png',
      emailVerified: true,
    };

    expect(toDashboardUser(user, 'identity-user-id')).toEqual({
      id: 'u-1',
      email: 'a@b.c',
      name: '张三',
      picture: 'https://cdn/a.png',
      emailVerified: true,
    });
  });

  it('字段为显式 null 时：不被兜底覆盖（只是原样透传）', () => {
    const user = {
      id: 'u-2',
      email: null,
      name: '李四',
      avatarUrl: null,
      emailVerified: null,
    };

    expect(toDashboardUser(user, 'identity-user-id')).toEqual({
      id: 'u-2',
      email: null,
      name: '李四',
      picture: null,
      emailVerified: null,
    });
  });
});
