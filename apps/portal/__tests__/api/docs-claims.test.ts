/**
 * 文档里"声明的数字"必须等于树里的实际数字（确定性检查）
 *
 * ## 为什么
 *
 * 一个会话内出现过 4 次数字漂移（迁移前点位 53→实测 50、夹具数 7→9→10、文件数 11→10、
 * 用例归因 -18 里混进 2 例真实断言）。手抄的数字会漂移，而漂移的文档正是本仓
 * ADR-019 记录过的那类问题。**造检查优先于写规则**：这类数字全都可从树里重算。
 *
 * 零新增 CI 步骤：跑在既有的 `pnpm test` 里（API project）。
 *
 * ## 覆盖的声明
 *
 * 1. 守卫的**夹具数**与**全量扫描断言数**（ADR-022 §4(d)、§强制点表、solution §4 共三处）；
 * 2. ADR-022 §1 的**豁免清单**与守卫 `EXEMPT_PREFIXES` 集合相等（两个副本，必须同进同退）。
 *
 * 检查刻意**要求声明存在**（匹配数下限）：把声明删掉不能让检查变绿——否则删文档就成了
 * 绕过检查的最短路径。
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const GUARD = join(REPO_ROOT, 'apps/portal/__tests__/api/module-mock-guard.test.ts');
const ADR = join(REPO_ROOT, 'docs/adr/ADR-022-test-authenticity-strategy.md');
const SOLUTION = join(REPO_ROOT, 'docs/solution/2026-10-12-test-authenticity-remediation.md');

const read = (p: string) => readFileSync(p, 'utf-8');

/** 数某个 describe 区块里的 `it(` 个数（按文本切片，避免依赖 vitest 的运行时 API） */
function countCases(section: string): number {
  return [...section.matchAll(/^\s*it\(/gm)].length;
}

/** 守卫的两块：违例夹具 / 全量扫描 */
function guardCaseCounts(source: string): { fixtures: number; fullScan: number } {
  const fixturesAt = source.indexOf("describe('module-mock-guard —— 违例夹具");
  const fullScanAt = source.indexOf("describe('module-mock-guard —— 全量扫描");
  expect(fixturesAt).toBeGreaterThan(-1);
  expect(fullScanAt).toBeGreaterThan(fixturesAt);
  return {
    fixtures: countCases(source.slice(fixturesAt, fullScanAt)),
    fullScan: countCases(source.slice(fullScanAt)),
  };
}

/** 文档里 `N 个违例夹具 + M 条全量扫描` 的每一处声明 */
function claimsIn(doc: string): Array<{ fixtures: number; fullScan: number }> {
  return [...doc.matchAll(/(\d+)\s*个违例夹具\s*\+\s*(\d+)\s*条全量扫描/g)].map((m) => ({
    fixtures: Number(m[1]),
    fullScan: Number(m[2]),
  }));
}

/** 归一化豁免项：`@/infrastructure/**` 与 `@/infrastructure/` 视为同一项 */
const normalizeExempt = (raw: string): string => raw.replace(/[*]+$/, '').replace(/\/+$/, '');

/** 守卫里的豁免清单 */
function guardExemptions(source: string): Set<string> {
  const block = source.slice(source.indexOf('const EXEMPT_PREFIXES = ['), source.indexOf('] as const;'));
  return new Set([...block.matchAll(/'([^']+)'/g)].map((m) => normalizeExempt(m[1]!)));
}

/** ADR-022 §1 里那张"明确豁免"清单 */
function adrExemptions(doc: string): Set<string> {
  const line = doc.split('\n').find((l) => l.includes('**明确豁免**'));
  expect(line, 'ADR-022 §1 的"明确豁免"清单不见了').toBeTruthy();
  return new Set([...line!.matchAll(/`([^`]+)`/g)].map((m) => normalizeExempt(m[1]!)));
}

describe('文档声明的数字与树一致', () => {
  it('抽取器本身可信（切片计数与正则抓取都有已知答案）', () => {
    expect(countCases("describe('x', () => {\n  it('a', () => {});\n  it('b', () => {});\n});")).toBe(2);
    expect(claimsIn('由 **3 个违例夹具 + 1 条全量扫描断言** 在 CI 里真跑')).toEqual([
      { fixtures: 3, fullScan: 1 },
    ]);
  });

  it('守卫的夹具数 / 全量扫描数：三处声明都必须等于实测', () => {
    const actual = guardCaseCounts(read(GUARD));
    const adr = read(ADR);
    const solution = read(SOLUTION);

    const claims = [
      ...claimsIn(adr).map((c) => ({ ...c, where: 'ADR-022' })),
      ...claimsIn(solution).map((c) => ({ ...c, where: 'solution' })),
    ];

    // 声明必须存在（删掉声明不能变绿）
    expect(claims.length).toBeGreaterThanOrEqual(3);

    const wrong = claims
      .filter((c) => c.fixtures !== actual.fixtures || c.fullScan !== actual.fullScan)
      .map((c) => `${c.where}: 声明 ${c.fixtures}+${c.fullScan}，实测 ${actual.fixtures}+${actual.fullScan}`);

    expect(wrong).toEqual([]);
  });

  it('豁免清单：守卫代码与 ADR-022 §1 集合相等（两个副本必须同进同退）', () => {
    const code = guardExemptions(read(GUARD));
    const doc = adrExemptions(read(ADR));

    const missingInDoc = [...code].filter((x) => !doc.has(x));
    const extraInDoc = [...doc].filter((x) => !code.has(x));

    expect({ missingInDoc, extraInDoc }).toEqual({ missingInDoc: [], extraInDoc: [] });
  });
});
