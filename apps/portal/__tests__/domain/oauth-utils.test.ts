/**
 * OAuth HTTP 辅助函数测试
 *
 * @req A-NAV-01
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { resolvePortalLandingPath, safeRedirectPath } from '@/lib/oauth-utils';

describe('safeRedirectPath', () => {
  it('保留同源相对路径', () => {
    expect(safeRedirectPath('/users?page=2#list')).toBe('/users?page=2#list');
  });

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example'])(
    '拒绝跨源路径 %s',
    (target) => {
      expect(safeRedirectPath(target)).toBeNull();
    },
  );
});

describe('resolvePortalLandingPath', () => {
  it('无权限用户固定进入无权限页', () => {
    expect(resolvePortalLandingPath('/users', false)).toBe('/no-access');
  });

  it('有权限用户回到已消毒路径', () => {
    expect(resolvePortalLandingPath('/users', true)).toBe('/users');
  });

  it('危险路径回退到工作台', () => {
    expect(resolvePortalLandingPath('//evil.example', true)).toBe('/dashboard');
  });
});
