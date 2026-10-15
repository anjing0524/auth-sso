/**
 * `test-support/repo-scan.ts` 的直接测试
 *
 * 为什么需要：这个 module 是**所有静态守卫的底座**（8 个守卫共用它的 root / walk /
 * 非空断言）。它自己没有测试面的话，一次"walk 少走一层目录"的改动会让所有守卫一起变绿
 * ——那正是本仓反复治理的"检查在假绿"。接口就是测试面：下面直接打它的接口。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  REPO_ROOT,
  assertScannedNonEmpty,
  isCommentLine,
  stripComments,
  tsFiles,
  walk,
} from '../helpers/repo-scan';

/** 临时目录：只在本次测试内存在，结束时清掉（不污染仓库） */
const scratch = mkdtempSync(join(tmpdir(), 'repo-scan-test-'));
mkdirSync(join(scratch, 'nested/deep'), { recursive: true });
writeFileSync(join(scratch, 'a.ts'), 'export const a = 1;\n');
writeFileSync(join(scratch, 'a.test.ts'), 'export const t = 1;\n');
writeFileSync(join(scratch, 'nested/b.tsx'), 'export const b = 1;\n');
writeFileSync(join(scratch, 'nested/deep/c.rs'), 'fn main() {}\n');
writeFileSync(join(scratch, 'README.md'), '# not code\n');

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('repo-scan —— 仓库根', () => {
  it('REPO_ROOT 指向含 pnpm-workspace.yaml 的目录（与调用方所在层级无关）', () => {
    expect(walk(REPO_ROOT, (n) => n === 'pnpm-workspace.yaml')).toEqual([
      join(REPO_ROOT, 'pnpm-workspace.yaml'),
    ]);
  });
});

describe('repo-scan —— walk / tsFiles', () => {
  it('walk 递归且只收匹配项', () => {
    const ts = walk(scratch, (n) => n.endsWith('.ts'));
    expect(ts.map((p) => p.replace(`${scratch}/`, '')).sort()).toEqual(['a.test.ts', 'a.ts']);
  });

  it('walk 对不存在的目录返回空数组（而不是抛错）', () => {
    expect(walk(join(scratch, 'does-not-exist'), () => true)).toEqual([]);
  });

  it('walk 尊重 skipDirs（整棵跳过）', () => {
    const withSkip = walk(scratch, (n) => n.endsWith('.ts'), new Set(['nested']));
    expect(withSkip.map((p) => p.replace(`${scratch}/`, ''))).toEqual(['a.test.ts', 'a.ts']);
  });

  it('tsFiles 默认排除 *.test.ts，includeTests 时包含', () => {
    const names = (files: string[]) => files.map((p) => p.replace(`${scratch}/`, '')).sort();
    expect(names(tsFiles(scratch))).toEqual(['a.ts', 'nested/b.tsx']);
    expect(names(tsFiles(scratch, { includeTests: true }))).toEqual([
      'a.test.ts',
      'a.ts',
      'nested/b.tsx',
    ]);
  });
});

describe('repo-scan —— assertScannedNonEmpty（"空扫描即假绿"）', () => {
  it('低于下限时抛出，且消息里给出实测值与期望值', () => {
    expect(() => assertScannedNonEmpty([], '某个扫描范围')).toThrow(/实测 0，期望 ≥ 1/);
    expect(() => assertScannedNonEmpty(['a'], '某个扫描范围', 2)).toThrow(/实测 1，期望 ≥ 2/);
  });

  it('达到下限时通过（含恰好等于）', () => {
    expect(() => assertScannedNonEmpty(['a'], 'x')).not.toThrow();
    expect(() => assertScannedNonEmpty(['a', 'b'], 'x', 2)).not.toThrow();
  });

  it('对非字符串元素同样有效（只看长度 ⇒ 泛型）', () => {
    expect(() => assertScannedNonEmpty([{ abs: 'a', rel: 'b' }], 'x')).not.toThrow();
  });
});

describe('repo-scan —— 注释判定', () => {
  it('整行注释（//、*、/*）都算注释行', () => {
    expect(isCommentLine('// callSomething(x)')).toBe(true);
    expect(isCommentLine(' * callSomething(x)')).toBe(true);
    expect(isCommentLine('/* callSomething(x) */')).toBe(true);
  });

  it('给了 codeToken 时，只把"token 之前有 //"的行算注释（行尾注释）', () => {
    expect(isCommentLine("const a = 1; // callSomething('@/x')", 'callSomething(')).toBe(true);
    expect(isCommentLine("callSomething('@/x'); // 说明", 'callSomething(')).toBe(false);
  });

  it('不给 codeToken 时，带代码的行一律不算注释（避免误跳过真实点位）', () => {
    expect(isCommentLine("callSomething('@/x'); // 说明")).toBe(false);
  });

  it('stripComments 去掉块注释与行注释，但不动 `https://` 这类非注释斜杠', () => {
    expect(stripComments('const a = 1; /* 块 */ // 行\nconst b = 2;')).toBe(
      'const a = 1;  \nconst b = 2;',
    );
    expect(stripComments("const url = 'https://example.com/x';")).toBe(
      "const url = 'https://example.com/x';",
    );
  });
});
