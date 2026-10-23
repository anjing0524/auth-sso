/**
 * F7（task-16）页面级修复的机械守卫（纯 fs 扫描 + 纯函数）
 *
 * 这些点位无法用 jsdom 行为测试覆盖（Server Component 布局类、metadata、HTTP 404 分支、
 * 对话框确认文案等），用源码扫描钉住"修复后的形状"，防止回退。
 *
 * @req U-U02, U-USERS01, U-UD01, U-DASH01, U-SEA01, U-LOG02, U-CLIENT01, U-CLIENT02,
 *       U-PF02, U-G09, U-LOGIN01, U-G07
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { USER_ERRORS } from '@auth-sso/contracts';
import { userFacingMessage } from '@/app/(dashboard)/users/components/user-error-copy';

/** __tests__/components → apps/portal */
const portalRoot = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(portalRoot, rel), 'utf8');

describe('U-U02/U-G02 — users 越界页与筛选空态', () => {
  it('users/page.tsx 把 ?page=999 钳制到最后一个有效页（保留筛选）', () => {
    const source = read('src/app/(dashboard)/users/page.tsx');
    expect(source).toContain('pagination.totalPages');
    expect(source).toContain('redirect(`/users?');
    expect(source).toContain('const isFiltered');
    expect(source).toContain('isFiltered={isFiltered}');
  });

  it('UserTable 筛选空态使用共享 EmptyState kind=filtered + clearAction', () => {
    const source = read('src/app/(dashboard)/users/components/UserTable.tsx');
    expect(source).toContain('kind="filtered"');
    expect(source).toContain('clearAction={{ label: \'清除筛选\'');
  });

  it('ClientsTable 同样接入 filtered 空态', () => {
    const source = read('src/app/(dashboard)/clients/components/ClientsTable.tsx');
    expect(source).toContain('kind="filtered"');
    expect(source).toContain('clearAction={{ label: \'清除筛选\'');
  });
});

describe('U-USERS01 — 行内详情入口按 user:read', () => {
  it('UserTable 的详情链接由 READ 权限守卫（不再由 UPDATE 守卫）', () => {
    const source = read('src/app/(dashboard)/users/components/UserTable.tsx');
    const detailBlock = source.slice(source.indexOf('/users/${user.id}') - 400, source.indexOf('/users/${user.id}'));
    expect(detailBlock).toContain('USER_PERMISSIONS.READ');
    expect(source).not.toContain('aria-label="详情/编辑"');
  });
});

describe('U-UD01 — 用户详情 390px 响应式', () => {
  const source = read('src/app/(dashboard)/users/[id]/UserDetailForm.tsx');
  it('移动端纵向堆叠、lg 才分栏', () => {
    expect(source).toContain('grid-cols-1');
    expect(source).toContain('lg:grid-cols-12');
    expect(source).toContain('lg:col-span-8');
    expect(source).toContain('lg:col-span-4');
    expect(source).toContain('sm:grid-cols-2');
  });
  it('页头操作换行 + 移动端底部固定保存条（保存不被裁出视口）', () => {
    expect(source).toContain('flex flex-wrap');
    expect(source).toContain('sticky bottom-0');
    expect(source).toContain('lg:hidden');
  });
});

describe('U-DASH01 — dashboard 快捷入口按 CREATE 权限裁剪', () => {
  it('新建用户/应用接入使用 CREATE 权限，而非 LIST', () => {
    const source = read('src/app/(dashboard)/dashboard/page.tsx');
    expect(source).toContain('USER_PERMISSIONS.CREATE');
    expect(source).toContain('CLIENT_PERMISSIONS.CREATE');
    expect(source).toContain('{canUserCreate && (');
    expect(source).toContain('{canClientCreate && (');
  });
});

describe('U-SEA01/U-LOG02 — 审计页提示与页签语义', () => {
  const source = read('src/app/(dashboard)/audit-logs/page.tsx');
  it('只保留一份 lg:hidden 滚动提示，且无 md:hidden 残留', () => {
    expect(source.match(/data-scroll-hint/g)?.length).toBe(1);
    expect(source).toContain('lg:hidden');
    expect(source).not.toContain('md:hidden');
  });
  it('页签具备 role=tab / aria-selected / tabpanel + roving tabindex', () => {
    // 2026-10-23（本轮 U-DEP04/U-LOG02 补全）：页签从 page 内联抽出为
    // `audit-logs/components/audit-tabs.tsx`（客户端组件，补 WAI-ARIA 键盘语义）。
    const tabsSource = read('src/app/(dashboard)/audit-logs/components/audit-tabs.tsx');
    expect(source).toContain('role="tabpanel"');
    expect(source).toContain('<AuditTabs');
    expect(tabsSource).toContain('role="tablist"');
    expect(tabsSource).toContain('role="tab"');
    expect(tabsSource).toContain('aria-selected={selected}');
    expect(tabsSource).toContain('tabIndex={focused === value ? 0 : -1}');
    expect(tabsSource).toContain("case 'ArrowRight':");
  });
});

describe('U-CLIENT01/02 — 应用页 404 与注册校验', () => {
  it('不存在的 Client 走 notFound()（与全站 404 一致）', () => {
    const source = read('src/app/(dashboard)/clients/[id]/page.tsx');
    expect(source).toContain('notFound()');
    expect(source).not.toContain('Client 不存在');
  });
  it('注册页前端校验 + 名称 maxLength', () => {
    const source = read('src/app/(dashboard)/clients/new/page.tsx');
    expect(source).toContain('maxLength={100}');
    expect(source).toContain('isHttpUrl');
    expect(source).toContain('role="alert"');
  });
});

describe('U-PF02 / U-G09 — 退出确认与 metadata', () => {
  it('profile 退出当前会话有二次确认', () => {
    const source = read('src/app/(dashboard)/profile/ProfileClient.tsx');
    expect(source).toContain('退出当前会话？');
    expect(source).toContain('setLogoutConfirmOpen');
  });

  it('五个列表/首页 metadata title 齐全', () => {
    const expectations: Array<[string, string]> = [
      ['src/app/(dashboard)/users/page.tsx', '用户管理 | Auth-SSO'],
      ['src/app/(dashboard)/clients/page.tsx', '应用管理 | Auth-SSO'],
      ['src/app/(dashboard)/dashboard/page.tsx', '工作台 | Auth-SSO'],
      ['src/app/(dashboard)/profile/page.tsx', '个人中心 | Auth-SSO'],
      ['src/app/(dashboard)/audit-logs/page.tsx', '审计日志 | Auth-SSO'],
    ];
    for (const [file, title] of expectations) {
      expect(read(file)).toContain(`metadata = { title: '${title}' }`);
    }
  });
});

describe('U-LOGIN01 — 登录输入 autocomplete', () => {
  it('邮箱/密码输入具备自动填充语义', () => {
    const source = read('src/app/login/login-form.tsx');
    expect(source).toContain('autoComplete="username"');
    expect(source).toContain('autoComplete="current-password"');
  });
});

describe('U-G07 — 用户域错误文案中文化', () => {
  it('重复邮箱/用户名按错误码映射中文（不再直出 "User 的 email 已存在"）', () => {
    expect(userFacingMessage({ error: USER_ERRORS.EMAIL_ALREADY_EXISTS, message: 'User 的 email 已存在' }))
      .toBe('该邮箱已被使用，请换一个');
    expect(userFacingMessage({ error: USER_ERRORS.USERNAME_ALREADY_EXISTS, message: 'User 的 username 已存在' }))
      .toBe('该用户名已被使用，请换一个');
    // 未映射的码保留服务端消息（可诊断）
    expect(userFacingMessage({ error: 'AUTH_SSO_1005', message: '姓名为空' })).toBe('姓名为空');
  });
});
