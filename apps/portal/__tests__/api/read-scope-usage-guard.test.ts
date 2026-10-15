/**
 * 读路径数据范围守卫 —— "取了范围就必须用它"
 *
 * ## 为什么（架构巡检候选 3）
 *
 * 读路径的失效模式是 **fail-open**：过滤条件缺失时静默退化为"不过滤"，返回全表
 * （`roles/data.ts` 曾因此返回全部部门的角色）。本仓已经把原语做得很难用错——
 * `scopeFilter` 空范围恒 `FALSE`、`UserScope` 用对象包裹以区分"未取快照"与"范围为空"——
 * 但**最后一公里**仍靠人：调用点得记得把范围用上。
 *
 * 巡检实测：当前 9 个 `resolveScope` 调用点**全部**把结果传进了带范围的读函数（无活的
 * fail-open），`data.ts` 一族也都用了 `isScopeDenied` + `scopeFilter`。所以这里不建
 * 新的 seam（那会只省一行、却把"必须在缓存作用域外解析"的约束藏起来），
 * 而是把这个不变量变成**机械可查**的两条规则：
 *
 * 1. **取了不用**：`const scope = await resolveScope(...)` 之后 `scope` 再没被引用
 *    ⇒ 报（这是"忘了用它"的直接形态）。
 * 2. **收了不用**：函数签名里收了**注解为 `UserScope`** 的参数，函数体内却从未引用
 *    ⇒ 报（这是"范围参数被吞掉"的形态，等价于可选范围参数那种 fail-open）。
 *    注意只认 `UserScope` 注解：按参数**名** `scope` 判会误报 OAuth scope（`string`，实测踩到）。
 *
 * 与 `module-mock-guard` / `gate-inventory-guard` 同构：规则本体在**本文件的注释**里，
 * 守卫是可执行副本，并自带夹具自测（解析器失灵会让守卫"永远通过"）。
 *
 * @module __tests__/api/read-scope-usage-guard
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REPO_ROOT,
  assertScannedNonEmpty,
  stripComments,
  tsFiles,
} from '../helpers/repo-scan';

/** 扫描范围：`apps/portal/src` 下的生产 TS（不含测试与 .d.ts） */
function scanFiles(): string[] {
  const files = tsFiles(join(REPO_ROOT, 'apps/portal/src')).filter((f) => !f.endsWith('.d.ts'));
  assertScannedNonEmpty(files, 'apps/portal/src 下的生产 .ts 扫描范围（读路径范围使用检查）', 40);
  return files;
}

/** 定位 `function` 形参表之后的函数体（花括号配对；不做完整解析，但足够定位"用了没"） */
function bodyAfterSignature(source: string, fromIndex: number): string | null {
  const open = source.indexOf('{', fromIndex);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

export interface ScopeViolation {
  file: string;
  line: number;
  kind: 'resolve-scope-unused' | 'scope-param-unused';
  detail: string;
}

/** 规则 1：`const scope = await resolveScope(…)` 的结果必须再被引用 */
function findResolveScopeUnused(source: string): ScopeViolation[] {
  const code = stripComments(source);
  const found: ScopeViolation[] = [];
  // 允许 `= 条件 ? await resolveScope(…) : { deptIds: [] }` 这类三元取法
  // （5 个 page.tsx 全是这个形状——评审实测：只认 `= await resolveScope(` 时它们全被漏掉）
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*?(?:await\s+)?resolveScope\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const name = m[1]!;
    const after = code.slice(m.index + m[0].length);
    // 结果再出现一次即视为"用了"（传参、属性访问、判定都算）
    if (!new RegExp(`\\b${name}\\b`).test(after)) {
      found.push({
        file: '',
        line: code.slice(0, m.index).split('\n').length,
        kind: 'resolve-scope-unused',
        detail: `const ${name} = await resolveScope(…) 之后 ${name} 再未被引用 ⇒ 取了范围却没用（fail-open 形态）`,
      });
    }
  }
  return found;
}

/** 规则 2：名为 `scope` 的形参必须在函数体内被引用 */
function findScopeParamUnused(source: string): ScopeViolation[] {
  const found: ScopeViolation[] = [];
  const code = stripComments(source);
  // 形参表按**括号配对**截取：`(scope: UserScope, a: (x) => void, b: {c: string})`
  // 这类签名里含 `)` 的参数会让 `[^)]*` 提前截断，把签名内容当函数体（评审实测假阳性）
  const re = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const openParen = m.index + m[0].length - 1;
    let depth = 0;
    let closeParen = -1;
    for (let i = openParen; i < code.length; i += 1) {
      if (code[i] === '(') depth += 1;
      else if (code[i] === ')') {
        depth -= 1;
        if (depth === 0) { closeParen = i; break; }
      }
    }
    if (closeParen < 0) continue;
    const params = code.slice(openParen + 1, closeParen);
    // 只认**数据范围**：必须注解为 UserScope。
    // 反例（实测踩到）：`signAccessToken(…, scope: string)` 里的 scope 是 OAuth scope（JWT claim），
    // 与 OBAC 数据范围无关 ⇒ 按名字判定会误报。
    const hasScope = /(^|,)\s*scope\s*\??\s*:\s*(?:readonly\s+)?UserScope\b/.test(params);
    if (!hasScope) continue;
    const body = bodyAfterSignature(code, closeParen + 1);
    if (body === null) continue;
    if (!/\bscope\b/.test(body)) {
      found.push({
        file: '',
        line: code.slice(0, m.index).split('\n').length,
        kind: 'scope-param-unused',
        detail: `function ${m[1]}(… scope …) 的函数体从未引用 scope ⇒ 范围参数被吞掉（等价于不过滤）`,
      });
    }
  }
  return found;
}

/** 纯函数入口：源码 → 违例清单（夹具直接测它） */
export function findScopeUsageViolations(source: string): ScopeViolation[] {
  return [...findResolveScopeUnused(source), ...findScopeParamUnused(source)];
}

describe('read-scope-usage-guard —— 夹具（守卫自身被守）', () => {
  it('夹具 1：resolveScope 的结果从未被使用 ⇒ 报"取了不用"', () => {
    const src = `const scope = await resolveScope(db, userId);\nreturn restSuccess([]);`;
    const v = findScopeUsageViolations(src);
    expect(v.map((x) => x.kind)).toEqual(['resolve-scope-unused']);
    expect(v[0]!.line).toBe(1);
  });

  it('夹具 2：resolveScope 的结果被传下去 ⇒ 通过', () => {
    const src = `const scope = await resolveScope(db, userId);\nreturn restSuccess(await getUsers(scope));`;
    expect(findScopeUsageViolations(src)).toEqual([]);
  });

  it('夹具 3：收了 scope 形参却从不引用 ⇒ 报"收了不用"', () => {
    const src = `export async function getThings(userId: string, scope: UserScope) {\n  return db.select().from(schema.things);\n}`;
    const v = findScopeUsageViolations(src);
    expect(v.map((x) => x.kind)).toEqual(['scope-param-unused']);
  });

  it('夹具 4：收了 scope 并用于过滤 ⇒ 通过', () => {
    const src = `export async function getThings(scope: UserScope) {\n  if (isScopeDenied(scope)) return [];\n  return db.select().where(scopeFilter(scope, schema.things.deptId));\n}`;
    expect(findScopeUsageViolations(src)).toEqual([]);
  });

  it('夹具 5：三元取法 `= cond ? await resolveScope(…) : { deptIds: [] }` 也受规则 1 管', () => {
    const src = `const scope = identity ? await resolveScope(db, userId) : { deptIds: [] };\nreturn restSuccess([]);`;
    expect(findScopeUsageViolations(src).map((x) => x.kind)).toEqual(['resolve-scope-unused']);
  });

  it('夹具 6：签名里含括号的参数不得让规则 2 误判（按括号配对取签名）', () => {
    const src = `export function f(scope: UserScope, cb: (x: number) => void, o: { c: string }) {\n  return scope.deptIds.length + cb(1) + o.c.length;\n}`;
    expect(findScopeUsageViolations(src)).toEqual([]);
  });

  it('夹具 7：OAuth scope（字符串）不是数据范围 ⇒ 不报（实测踩到的假阳性）', () => {
    const src = `export async function signAccessToken(userId: string, scope: string) {\n  return jwt.sign({ sub: userId, scope });\n}`;
    expect(findScopeUsageViolations(src)).toEqual([]);
  });

  it('夹具 8：注释里提过 scope 不算"用了"（去注释后再判）', () => {
    const src = `export async function getThings(x: string, scope: UserScope) {\n  // 这里本该用 scope 过滤\n  return [];\n}`;
    expect(findScopeUsageViolations(src)[0]!.kind).toBe('scope-param-unused');
  });

  it('夹具 9：注释掉的 resolveScope 调用不会被误报', () => {
    const src = `// const scope = await resolveScope(db, userId);\nreturn [];`;
    expect(findScopeUsageViolations(src)).toEqual([]);
  });
});

describe('read-scope-usage-guard —— 全量扫描', () => {
  it('生产代码里没有"取了范围不用"或"收了范围不用"的函数', () => {
    const violations: string[] = [];
    for (const abs of scanFiles()) {
      const rel = relative(REPO_ROOT, abs);
      for (const v of findScopeUsageViolations(readFileSync(abs, 'utf-8'))) {
        violations.push(`${rel}:${v.line} [${v.kind}] ${v.detail}`);
      }
    }
    expect(violations.join('\n')).toBe('');
  });
});
