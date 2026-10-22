/**
 * `docs/spec` 里的 `AUTH_SSO` 错误码必须与 `packages/contracts` **机械对齐**（#93）
 *
 * ## 为什么
 *
 * 契约码是**线值**：文档、前端、外部集成都按它对接。但文档与契约之间此前只有**人工**对齐，
 * 而两者都在动：
 *
 * - R30 我在 `docs/spec/API.md` 里留下了已删除的 `AUTH_SSO_1001` / `AUTH_SSO_1007` 两行
 *   —— 文档列着**不存在的码**；
 * - #82 把契约码从 57 删到 33：**每次删码都可能让文档变成谎言**，且没有任何检查盯着。
 *
 * 这正是 `CODING_STANDARDS.md` §7「声称强制的必须指出阻断点」的形态：
 * 文档说"这是错误码表"，就得有东西保证它**真的是**。
 *
 * ## 两条规则（互补）
 *
 * 1. **键与线值双向对齐**：文档里的 `` `AUTH_SSO_<n>` (`NAME`) `` 对，
 *    必须在契约中存在键 `NAME`，且它的**值**就是 `AUTH_SSO_<n>`
 *    （只查"码存在"是不够的——键挂错同样会让读者按错的语义写代码）。
 * 2. **每个 token 都真实**：文档里出现的每个 `AUTH_SSO_<n>`（含总表那种不带名字的引用）
 *    都必须是契约里的真实线值。
 *
 * 解析器自带夹具自测：正则失灵会让守卫"永远通过"。
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { REPO_ROOT } from '../helpers/repo-scan';
import { join } from 'node:path';
import * as contracts from '@auth-sso/contracts';

const SPEC_DIR = join(REPO_ROOT, 'docs/spec');

/** 契约的错误组（与 `packages/contracts/src/errors.ts` 的导出名一致） */
const ERROR_GROUPS = [
  'COMMON_ERRORS',
  'AUTH_ERRORS',
  'USER_ERRORS',
  'DEPARTMENT_ERRORS',
  'ROLE_ERRORS',
  'PERMISSION_ERRORS',
  'CLIENT_ERRORS',
] as const;

/** 契约全表：键 → 线值 */
function contractCodeTable(): Map<string, string> {
  const table = new Map<string, string>();
  for (const group of ERROR_GROUPS) {
    const entries = (contracts as unknown as Record<string, Record<string, string>>)[group];
    if (!entries) continue;
    for (const [key, value] of Object.entries(entries)) table.set(key, value);
  }
  return table;
}

/** 解析 `` `AUTH_SSO_<n>` (`NAME`) `` 对（返回码、名字、行号） */
function parseCodeNamePairs(source: string): { code: string; name: string; line: number }[] {
  const pairs: { code: string; name: string; line: number }[] = [];
  source.split('\n').forEach((line, index) => {
    const re = /`AUTH_SSO_(\d+)`\s*\(([A-Z][A-Z0-9_]*)\)/g;
    for (const m of line.matchAll(re)) {
      pairs.push({ code: `AUTH_SSO_${m[1]}`, name: m[2]!, line: index + 1 });
    }
  });
  return pairs;
}

/** 解析文档里出现的**每个** `AUTH_SSO_<n>` token（含不带名字的引用） */
function parseCodeTokens(source: string): { code: string; line: number }[] {
  const tokens: { code: string; line: number }[] = [];
  source.split('\n').forEach((line, index) => {
    for (const m of line.matchAll(/AUTH_SSO_(\d+)/g)) {
      tokens.push({ code: `AUTH_SSO_${m[1]}`, line: index + 1 });
    }
  });
  return tokens;
}

function specFiles(): string[] {
  return readdirSync(SPEC_DIR)
    .filter((n) => n.endsWith('.md'))
    .map((n) => join(SPEC_DIR, n))
    .sort();
}

describe('docs/spec 的 AUTH_SSO 码与 contracts 对齐（#93）', () => {
  it('解析器自测（正则失灵会让守卫永远通过）', () => {
    const fixture = [
      '| `AUTH_SSO_2002` (INVALID_CREDENTIALS) | 401 | 用户名或密码错误 |',
      '| 资源不存在 | 404 | `{ "error": "AUTH_SSO_1004" }` |',
    ].join('\n');
    expect(parseCodeNamePairs(fixture)).toEqual([
      { code: 'AUTH_SSO_2002', name: 'INVALID_CREDENTIALS', line: 1 },
    ]);
    expect(parseCodeTokens(fixture)).toEqual([
      { code: 'AUTH_SSO_2002', line: 1 },
      { code: 'AUTH_SSO_1004', line: 2 },
    ]);

    const files = specFiles();
    expect(files.length).toBeGreaterThanOrEqual(5);
    const allPairs = files.flatMap((f) => parseCodeNamePairs(readFileSync(f, 'utf-8')));
    const allTokens = files.flatMap((f) => parseCodeTokens(readFileSync(f, 'utf-8')));
    expect(allPairs.length, '未解析到任何 (码, 名字) 对，解析器或文档形态已变').toBeGreaterThanOrEqual(10);
    expect(allTokens.length).toBeGreaterThanOrEqual(15);
  });

  it('错误组清单与 contracts 的导出一致（契约新增第 8 组不会被静默漏检）', () => {
    const exported = Object.keys(contracts).filter((k) => k.endsWith('_ERRORS')).sort();
    expect(exported, '契约新增/改名了错误组 ⇒ 请同步本文件的 ERROR_GROUPS').toEqual([...ERROR_GROUPS].sort());
  });

  it('每个 (`AUTH_SSO_<n>`, NAME) 对的键与线值双向对齐', () => {
    const table = contractCodeTable();
    const problems: string[] = [];
    for (const file of specFiles()) {
      const rel = file.replace(`${REPO_ROOT}/`, '');
      for (const { code, name, line } of parseCodeNamePairs(readFileSync(file, 'utf-8'))) {
        const actual = table.get(name);
        if (actual === undefined) {
          problems.push(`${rel}:${line} 文档写了 ${code} (${name})，但契约里没有键 ${name}`);
        } else if (actual !== code) {
          problems.push(`${rel}:${line} 文档写 ${code} (${name})，契约里 ${name} = ${actual}`);
        }
      }
    }
    expect(problems, '文档与契约的错误码必须双向对齐（改一处就要改另一处）').toEqual([]);
  });

  it('文档里出现的每个 AUTH_SSO 码都是契约里的真实线值', () => {
    const values = new Set(contractCodeTable().values());
    const problems: string[] = [];
    for (const file of specFiles()) {
      const rel = file.replace(`${REPO_ROOT}/`, '');
      for (const { code, line } of parseCodeTokens(readFileSync(file, 'utf-8'))) {
        if (!values.has(code)) problems.push(`${rel}:${line} 引用了契约里不存在的码 ${code}`);
      }
    }
    expect(problems, '文档不得引用契约里已删除/从未存在的码').toEqual([]);
  });
});
