/**
 * 表单失败处置守卫 —— "失败处置只有一个入口"
 *
 * ## 为什么（架构巡检候选 5）
 *
 * #82 让服务端能报**可判别**的冲突码，#92 把"有映射且本表单渲染了该字段 ⇒ 就地显示，
 * 否则回落 toast"这条判定收进 `useFieldFailure`。但巡检实测：**5 个 mutation 只有 3 个
 * 接了这条判定**——删除与状态切换在同一文件里直接 `toast.error(res.message)`，
 * 绕过了分类点。于是"每个失败要么落输入框、要么落提示"这条不变量**没有任何地方强制**，
 * 只靠人记得调 hook。
 *
 * 本守卫把最后一公里变成机械可查：**表单里不得把 Server Action 结果的 `message`
 * 直接交给 `toast.error`**——那正是绕过分类点的形状。要显示失败就用
 * `reportFailure(res)`（它自己决定就地还是 toast）。
 *
 * 误报出口：若某处的 toast **不是** action 结果（例如"两次输入的密码不一致"这类
 * 纯前端校验），直接在上一行或本行写 `// @allow-direct-toast: <理由>`。
 *
 * 与 `module-mock-guard` / `read-scope-usage-guard` 同构：规则本体在本文件的注释里，
 * 守卫是可执行副本，并自带夹具自测。
 *
 * @module __tests__/api/form-failure-handling-guard
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, assertScannedNonEmpty, stripComments, walk } from '../helpers/repo-scan';

/** 分类点自身：它当然会 toast，不算绕过 */
const CLASSIFICATION_POINT = join(REPO_ROOT, 'apps/portal/src/hooks/use-field-failure.ts');

/** 扫描范围：`apps/portal/src` 下所有表单/组件 */
function scanFiles(): string[] {
  const files = walk(join(REPO_ROOT, 'apps/portal/src'), (n) => n.endsWith('.tsx')).filter(
    (f) => f !== CLASSIFICATION_POINT,
  );
  assertScannedNonEmpty(files, 'apps/portal/src 下的 .tsx 扫描范围（表单失败处置检查）', 25);
  return files;
}

export interface ToastViolation {
  line: number;
  detail: string;
}

/**
 * 纯函数：源码 → 违例清单。
 *
 * 抓的是 `toast.error(<ident>.message …)` —— 变量来自 action 结果时即为绕过分类点。
 * 字面量（`toast.error('请填写必填字段')`）不算：那是前端自己的提示。
 */
export function findDirectActionToasts(source: string): ToastViolation[] {
  const code = stripComments(source);
  const rawLines = source.split('\n');
  const found: ToastViolation[] = [];
  code.split('\n').forEach((line, index) => {
    if (!/toast\.error\(/.test(line)) return;
    if (!/toast\.error\(\s*[A-Za-z_$][\w$]*\s*\.\s*message\b/.test(line)) return;
    // 允许出口写在**本行或上一行**（原文，不是去注释版）
    const context = `${rawLines[index - 1] ?? ''}\n${rawLines[index] ?? ''}`;
    if (context.includes('@allow-direct-toast')) return;
    found.push({
      line: index + 1,
      detail: '把 Server Action 结果的 message 直接交给 toast.error ⇒ 绕过了失败分类点（改用 reportFailure(res)）',
    });
  });
  return found;
}

describe('form-failure-handling-guard —— 夹具（守卫自身被守）', () => {
  it('夹具 1：toast.error(res.message) ⇒ 报"绕过分类点"', () => {
    const src = `if (!res.success) { toast.error(res.message); }`;
    const v = findDirectActionToasts(src);
    expect(v.map((x) => x.line)).toEqual([1]);
  });

  it('夹具 2：reportFailure(res) ⇒ 通过', () => {
    const src = `if (!res.success) { reportFailure(res); }`;
    expect(findDirectActionToasts(src)).toEqual([]);
  });

  it('夹具 3：字面量提示（前端自己的校验）⇒ 通过', () => {
    const src = `if (!form.name) { toast.error('请填写完整信息'); return; }`;
    expect(findDirectActionToasts(src)).toEqual([]);
  });

  it('夹具 4：显式允许出口（@allow-direct-toast）⇒ 通过', () => {
    const src = `// @allow-direct-toast: 纯前端校验，不是 action 结果\nif (bad) { toast.error(res.message); }`;
    expect(findDirectActionToasts(src)).toEqual([]);
  });

  it('夹具 5：注释里的形状不算（去注释后再判）', () => {
    const src = `// 以前是 toast.error(res.message)\nreportFailure(res);`;
    expect(findDirectActionToasts(src)).toEqual([]);
  });
});

describe('form-failure-handling-guard —— 全量扫描', () => {
  it('表单里没有绕过失败分类点的 toast', () => {
    const violations: string[] = [];
    for (const abs of scanFiles()) {
      const rel = relative(REPO_ROOT, abs);
      for (const v of findDirectActionToasts(readFileSync(abs, 'utf-8'))) {
        violations.push(`${rel}:${v.line} ${v.detail}`);
      }
    }
    expect(violations.join('\n')).toBe('');
  });
});
