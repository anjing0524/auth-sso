/**
 * H-C-03 / H-C-08 的机械守卫（纯 fs 扫描，无需基础设施）
 *
 * - H-C-03：注册 Client 后必须**一次性展示** Secret（此前 UI 丢弃
 *   `createClientAction` 返回值里的 clientSecret，而 DB 只存 bcrypt ⇒ 新应用无法使用）
 * - H-C-08：密码提示必须与后端策略一致（10 位 + 4 类中≥3，而 UI 曾写 8 位）
 *
 * @req G-CLT-C, NFR-SEC-05
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

describe('H-C-03 — 新注册 Client 的 Secret 必须展示一次', () => {
  it('clients/new 页面渲染 clientSecret（而非只 toast + 跳转）', () => {
    const source = read('src/app/(dashboard)/clients/new/page.tsx');
    // 返回值被收进组件状态
    expect(source).toContain('result.data.clientSecret');
    // 渲染在一次性弹窗里
    expect(source).toContain('created?.clientSecret');
    expect(source).toContain('Client Secret');
  });
});

describe('H-C-08 — UI 密码提示与后端策略一致（10 位/至少三类）', () => {
  it('个人中心改密提示', () => {
    const source = read('src/app/(dashboard)/profile/ProfileClient.tsx');
    expect(source).toContain('至少 10 位');
    expect(source).not.toContain('至少8位');
  });

  it('管理员重置密码提示', () => {
    const source = read('src/app/(dashboard)/users/[id]/ResetPasswordDialog.tsx');
    expect(source).toContain('至少 10 位');
    expect(source).not.toContain('至少 8 位');
  });

  it('创建用户初始密码提示', () => {
    const source = read('src/app/(dashboard)/users/components/CreateUserForm.tsx');
    expect(source).toContain('至少 10 位');
    expect(source).toContain('至少三类');
  });
});
