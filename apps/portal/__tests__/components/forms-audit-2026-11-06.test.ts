/**
 * 2026-11-06 PM/UX 走查修复的结构回归守卫
 *
 * 钉住本轮修复中容易被后续重构改回去的契约（均为源码断言，非行为测试）：
 * - UX-06：三张表单页（新建用户/新建权限/注册应用）统一使用 FormActionBar；
 * - UX-08：Scopes 帮助文案方位（输入框在标签下方）；
 * - UX-09：Token 有效期有换算提示，「创建后注意」在卡片最前；
 * - UX-12：不可逆操作实心 destructive + 危险确认弹窗单一取消（无右上角 X）；
 * - UX-13：回调白名单完整显示（换行不截断），注销禁用原因可见；
 * - UX-24：关键表单控件带 name / autocomplete。
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../helpers/repo-scan';

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf-8');

describe('2026-11-06 走查修复守卫', () => {
  it('UX-06：表单页统一 FormActionBar 操作条', () => {
    expect(read('apps/portal/src/app/(dashboard)/users/components/CreateUserForm.tsx')).toContain('<FormActionBar');
    expect(read('apps/portal/src/app/(dashboard)/permissions/permission-form.tsx')).toContain('<FormActionBar');
    expect(read('apps/portal/src/app/(dashboard)/clients/new/page.tsx')).toContain('<FormActionBar');
  });

  it('PM-02：新建用户表单接入了未保存离开守卫', () => {
    const form = read('apps/portal/src/app/(dashboard)/users/components/CreateUserForm.tsx');
    expect(form).toContain('useUnsavedChangesGuard');
    // 脏语义：任一字段非空或部门变化
    expect(form).toContain("value.trim() !== ''");
    expect(form).toContain('deptId !== defaultDeptId');
  });

  it('UX-08：Scopes 帮助文案指向下方输入框', () => {
    const page = read('apps/portal/src/app/(dashboard)/clients/new/page.tsx');
    expect(page).toContain('下方的输入框');
    expect(page).not.toContain('上面的输入框');
  });

  it('UX-09：Token 有效期换算提示 + 关键提示上移到卡片最前', () => {
    const page = read('apps/portal/src/app/(dashboard)/clients/new/page.tsx');
    expect(page).toContain('function formatTTL');
    expect(page.indexOf('创建后注意')).toBeLessThan(page.indexOf('Access Token 有效期'));
  });

  it('UX-12：删除用户为实心 destructive，危险确认弹窗单一取消', () => {
    const detail = read('apps/portal/src/app/(dashboard)/users/[id]/UserDetailForm.tsx');
    expect(detail).toContain('render={<Button variant="destructive" size="sm" />}');
    expect(detail).toContain('showCloseButton={false}');
    expect(read('apps/portal/src/app/(dashboard)/users/[id]/ResetPasswordDialog.tsx')).toContain('showCloseButton={false}');
    expect(read('apps/portal/src/app/(dashboard)/clients/[id]/ClientDetailClient.tsx')).toContain('showCloseButton={false}');
    expect(read('apps/portal/src/app/(dashboard)/clients/components/ClientsTable.tsx')).toContain('showCloseButton={false}');
  });

  it('UX-13：回调白名单完整显示，注销禁用原因可见', () => {
    const table = read('apps/portal/src/app/(dashboard)/clients/components/ClientsTable.tsx');
    expect(table).toContain('whitespace-normal break-all');
    expect(table).not.toContain('<span className="truncate">{formatRedirectUri(uri)}</span>');
    expect(table).toContain("title={client.clientId === PORTAL_CLIENT_ID ? 'Portal 自身客户端不可注销'");
    // 停用徽章悬停可见禁用后果与恢复入口
    expect(table).toContain('该应用无法发起新的授权');
    expect(table).toContain('重新启用');
  });

  it('UX-24：客户端与用户表单控件带 name / autocomplete', () => {
    const newClient = read('apps/portal/src/app/(dashboard)/clients/new/page.tsx');
    expect(newClient).toContain('name="redirectUris"');
    expect(newClient).toContain('autoComplete="url"');
    const infoSection = read('apps/portal/src/app/(dashboard)/clients/[id]/components/ClientInfoSection.tsx');
    expect(infoSection).toContain('name="redirectUris"');
    const userDetail = read('apps/portal/src/app/(dashboard)/users/[id]/UserDetailForm.tsx');
    expect(userDetail).toContain('name="email"');
    expect(userDetail).toContain('autoComplete="email"');
    const permForm = read('apps/portal/src/app/(dashboard)/permissions/permission-form.tsx');
    expect(permForm).toContain('name="code"');
  });

  it('PM-05：初始密码帮助文案说明首登强制改密', () => {
    const form = read('apps/portal/src/app/(dashboard)/users/components/CreateUserForm.tsx');
    expect(form).toContain('首次登录会被强制修改密码');
    expect(form).toContain('生成强密码');
  });
});
