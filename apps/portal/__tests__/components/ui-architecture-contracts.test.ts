/**
 * UI 架构不变量（只保留**无法用行为测试表达**的少数契约）。
 *
 * 历史 `crud-f7-guards.test.ts` 有 336 条源码字符串断言，和实现细节强耦合，
 * 无法证明页面行为/布局；已删除，行为由 API/组件/E2E/视觉回归覆盖。
 *
 * 本文件只守：
 * - 不得使用原生 alert/confirm/prompt（行为测试无法穷举所有调用点）；
 * - 不得使用 dangerouslySetInnerHTML（XSS 面）；
 * - 长表单必须页面化，禁止回归为用户/应用创建弹窗；
 * - 审计详情必须是独立路由，禁止回归为列表内弹窗。
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../helpers/repo-scan';

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf-8');

function walkTsx(dir: string): string[] {
  const absolute = join(REPO_ROOT, dir);
  const out: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const path = join(absolute, entry);
    if (statSync(path).isDirectory()) out.push(...walkTsx(`${dir}/${entry}`));
    else if (/\.(tsx|ts)$/.test(entry)) out.push(`${dir}/${entry}`);
  }
  return out;
}

describe('UI 架构不变量', () => {
  it('业务代码不得使用原生 alert/confirm/prompt', () => {
    const violations: string[] = [];
    for (const file of [...walkTsx('apps/portal/src/app'), ...walkTsx('apps/portal/src/components')]) {
      const source = read(file);
      if (/\bwindow\.(alert|confirm|prompt)\s*\(/.test(source)) violations.push(file);
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('业务代码不得使用 dangerouslySetInnerHTML', () => {
    const violations: string[] = [];
    for (const file of [...walkTsx('apps/portal/src/app'), ...walkTsx('apps/portal/src/components')]) {
      if (read(file).includes('dangerouslySetInnerHTML')) violations.push(file);
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('长表单创建保持页面化，不回归为用户/应用创建弹窗', () => {
    expect(existsSync(join(REPO_ROOT, 'apps/portal/src/app/(dashboard)/users/new/page.tsx'))).toBe(true);
    expect(existsSync(join(REPO_ROOT, 'apps/portal/src/app/(dashboard)/clients/new/page.tsx'))).toBe(true);
    expect(existsSync(join(REPO_ROOT, 'apps/portal/src/app/(dashboard)/users/components/CreateUserDialog.tsx'))).toBe(false);
    expect(existsSync(join(REPO_ROOT, 'apps/portal/src/app/(dashboard)/clients/components/CreateClientDialog.tsx'))).toBe(false);
  });

  it('审计详情保持独立路由，不回归为列表内弹窗', () => {
    expect(existsSync(join(REPO_ROOT, 'apps/portal/src/app/(dashboard)/audit-logs/[id]/page.tsx'))).toBe(true);
    expect(existsSync(join(REPO_ROOT, 'apps/portal/src/app/(dashboard)/audit-logs/components/AuditLogDetailDialog.tsx'))).toBe(false);
  });
});
