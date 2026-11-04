/**
 * 表单控件统一守卫（架构不变量）
 *
 * 页面不得绕过共享 Input/Select/Textarea 直接写原生控件；共享搜索框必须与
 * Input/SelectTrigger 同为 36px（h-9）。这不是行为测试，而是防止样式再次分叉。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../helpers/repo-scan';

const ROOT = 'apps/portal/src';

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...tsxFiles(rel));
    else if (entry.name.endsWith('.tsx')) out.push(rel);
  }
  return out;
}

describe('表单控件统一', () => {
  it('页面不直接使用原生 <select>，统一走共享 Select', () => {
    const offenders = tsxFiles(ROOT)
      .filter((file) => !file.startsWith(`${ROOT}/components/ui/`))
      .filter((file) => /<select\b/.test(readFileSync(join(REPO_ROOT, file), 'utf-8')));
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('共享 SearchInput 与 Input/Select 同高（h-9）', () => {
    const source = readFileSync(join(REPO_ROOT, 'apps/portal/src/components/shared/search-input.tsx'), 'utf-8');
    expect(source).toContain('h-9 pl-8 pr-8 text-sm');
    expect(source).not.toContain('h-8 pl-8');
  });
});
