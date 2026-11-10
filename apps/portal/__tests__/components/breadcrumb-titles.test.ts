/**
 * UX-07 回归：面包屑末级与页面 H1 / metadata 同名。
 *
 * 两层锁定：
 * 1) 纯函数对每条路由返回预期末级标题；
 * 2) 页面源码确实引用了同一个 PAGE_TITLES 常量（防止只改面包屑不改 H1）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildBreadcrumbTrail } from '@/components/layout/breadcrumbs';
import { PAGE_TITLES } from '@/lib/route-titles';

const SRC = path.resolve(__dirname, '../../src');
const read = (file: string): string => readFileSync(path.join(SRC, file), 'utf8');

describe('UX-07 面包屑末级与页面标题一致', () => {
  it.each([
    ['/users/new', PAGE_TITLES.NEW_USER],
    ['/users/uid-1/roles', PAGE_TITLES.ASSIGN_ROLE],
    ['/clients/new', PAGE_TITLES.NEW_CLIENT],
    ['/audit-logs/log-1', PAGE_TITLES.AUDIT_DETAIL],
    ['/permissions/new', PAGE_TITLES.NEW_PERMISSION],
    ['/permissions/perm-1/edit', PAGE_TITLES.EDIT_PERMISSION],
    ['/roles/role-1/permissions', PAGE_TITLES.ROLE_PERMISSIONS],
  ])('%s → 末级「%s」', (pathname, title) => {
    const crumbs = buildBreadcrumbTrail(pathname);
    expect(crumbs.at(-1)?.title).toBe(title);
    expect(crumbs.at(-1)?.url).toBe(pathname);
    expect(crumbs[1]?.url).toBe(`/${pathname.split('/')[1]}`);
  });

  it('工作台与一级模块页不追加多余末级', () => {
    expect(buildBreadcrumbTrail('/dashboard')).toEqual([{ title: '工作台', url: '/dashboard' }]);
    expect(buildBreadcrumbTrail('/users')).toHaveLength(2);
    expect(buildBreadcrumbTrail('/')).toHaveLength(1);
  });

  it('用户详情 H1 显示实体姓名，面包屑保留页面类型名（有意例外）', () => {
    expect(buildBreadcrumbTrail('/users/uid-1').at(-1)?.title).toBe(PAGE_TITLES.USER_DETAIL);
  });

  it.each([
    ['app/(dashboard)/users/new/page.tsx', 'NEW_USER'],
    ['app/(dashboard)/clients/new/page.tsx', 'NEW_CLIENT'],
    ['app/(dashboard)/permissions/new/page.tsx', 'NEW_PERMISSION'],
    ['app/(dashboard)/permissions/permission-form.tsx', 'NEW_PERMISSION'],
    ['app/(dashboard)/permissions/permission-form.tsx', 'EDIT_PERMISSION'],
    ['app/(dashboard)/audit-logs/[id]/page.tsx', 'AUDIT_DETAIL'],
    ['app/(dashboard)/roles/[id]/permissions/page.tsx', 'ROLE_PERMISSIONS'],
    ['app/(dashboard)/roles/[id]/permissions/permissions-client.tsx', 'ROLE_PERMISSIONS'],
  ])('%s 引用 PAGE_TITLES.%s', (file, key) => {
    expect(read(file)).toContain(`PAGE_TITLES.${key}`);
  });

  it('审计详情三个类型分支的 H1 全部改用同一标题', () => {
    const source = read('app/(dashboard)/audit-logs/[id]/page.tsx');
    expect(source.match(/title=\{PAGE_TITLES\.AUDIT_DETAIL\}/g)).toHaveLength(3);
    for (const stale of ['登录日志详情', '访问日志详情', '操作日志详情']) {
      expect(source).not.toContain(`title="${stale}"`);
    }
  });
});
