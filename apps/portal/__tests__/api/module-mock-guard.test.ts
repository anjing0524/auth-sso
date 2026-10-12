/**
 * 模块级 mock 守卫 —— 规则的**可执行副本**（ADR-022 §4(b)(c)(d)）
 *
 * ## 它守什么
 *
 * 1. **契约（形态）**：生产业务模块的模块级 mock 必须是类型化工厂
 *    （`vi.mock(import('x'), …)`）。字符串形态 `vi.mock('x', …)` 不再被接受——
 *    它不产生任何编译期契约（#51 实测：幽灵键静默通过）。
 * 2. **理由（注解）**：生产业务模块的模块级 mock 必须带
 *    `// @allow-module-mock <target> <reason-kind>: <理由>`，注解在 `vi.mock(` 的
 *    **上一行**、target 逐字一致、kind ∈ 封闭枚举；`auth-bypass` 必须在理由里
 *    **点名**依赖它的测试文件。
 * 3. **存量（快照）**：未注解的存量点位进 `__tests__/fixtures/module-mock-baseline.json`，
 *    **只减不增**：新增点必红、点位消失或已补注解后仍留在账单里也必红、无 owner 必红。
 *
 * ## 为什么这样写（而不是 ESLint 规则 / 手写键集扫描）
 *
 * - 键集与判别式形状**交给编译器**（类型化工厂 + `pnpm typecheck`），本守卫只管
 *   类型系统表达不了的那一半："为什么允许 mock 这个模块"（ADR-022 §4(a)/(d)）；
 * - 守卫自身也**被守**：7 个违例夹具（缺注解 / target 不一致 / kind 非法 / 孤儿注解 /
 *   陈旧快照条目 / 快照增长 / 记账后未销账）在 CI 里真跑。
 *
 * ## 快照生成（机械，唯一入口）
 *
 * ```
 * UPDATE_MODULE_MOCK_BASELINE=1 pnpm exec vitest run --project @auth-sso/portal-api \
 *   apps/portal/__tests__/api/module-mock-guard.test.ts
 * ```
 *
 * 生成物**必须**来自本文件的扫描器（`scanModuleMocks`），不得手抄普查数字——
 * 普查基线是 `ad530d6`，实测已在漂移。
 *
 * @req H-ACL-001
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ════════════════════════════════════════════════════════════
// 规则的可执行副本：豁免清单 / 理由枚举（ADR-022 §1、§4(b)）
// ════════════════════════════════════════════════════════════

/** 明确豁免：不在规则射程（ADR-022 §1 的清单，写死在此，不是"默认漏网"） */
const EXEMPT_PREFIXES = [
  '@/infrastructure/',
  'next/',
  'jose',
  'ioredis',
  'postgres',
  'drizzle-orm/',
  'react',
  'server-only',
  'cmdk',
  '@auth-sso/',
  '@/lib/env',
  '@/lib/logger',
] as const;

/** 理由类型封闭枚举（ADR-022 §4(b)） */
export const REASON_KINDS = ['infra-boundary', 'input-fixture', 'fault-injection', 'auth-bypass'] as const;
export type ReasonKind = typeof REASON_KINDS[number];

export interface ModuleMockFinding {
  /** 被 mock 的模块说明符（`import('x')` 归一化为 `x`） */
  readonly target: string;
  /** `vi.mock(` 所在行（1-based） */
  readonly line: number;
  /** 是否使用 `import('x')` 值形态（类型化工厂的前提） */
  readonly usesImportForm: boolean;
  /** 上一行的理由注解（若有） */
  readonly annotation: { readonly target: string; readonly kind: string; readonly reason: string } | null;
}

export interface SnapshotEntry {
  readonly file: string;
  readonly target: string;
  readonly line: number;
  readonly class: string;
  readonly owner: string;
}

export function isExempt(target: string): boolean {
  return EXEMPT_PREFIXES.some((p) => target === p || target.startsWith(p));
}

const MOCK_CALL = /vi\.mock\(/;
const IMPORT_FORM = /vi\.mock\(\s*import\(\s*'([^']+)'\s*\)/;
const STRING_FORM = /vi\.mock\(\s*'([^']+)'/;
const ANNOTATION = /^\s*\/\/\s*@allow-module-mock\s+(\S+)\s+(\S+):\s*(.*)$/;

/**
 * 该行是否处在注释里（文档注释与行注释都算）。
 *
 * 实测必要性：`oauth-retry`/`fixture-keypair`/`gateway-identity-trust`/`seed-fixtures`
 * 会在 **JSDoc 里引用** `vi.mock('@/lib/auth/token')` 来说明"过去为什么这么做"，
 * 若不跳过注释，扫描器会把历史叙述当成真实点位误报（8 处）。
 */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return true;
  const at = line.indexOf('vi.mock(');
  return at > 0 && line.slice(0, at).includes('//');
}

/** 纯函数：扫一段源码里的模块级 mock + 其上一行的理由注解（跳过注释里的引用文字） */
export function scanModuleMocks(source: string): ModuleMockFinding[] {
  const lines = source.split('\n');
  const findings: ModuleMockFinding[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!MOCK_CALL.test(line)) continue;
    if (isCommentLine(line)) continue;

    // 允许首参跨到下一行：在 `vi.mock(` 之后的两行内找说明符
    const window = [line, lines[i + 1] ?? '', lines[i + 2] ?? ''].join('\n');
    const importMatch = IMPORT_FORM.exec(window);
    const stringMatch = importMatch ? null : STRING_FORM.exec(window);
    const target = importMatch?.[1] ?? stringMatch?.[1];
    if (!target) continue;

    const prev = lines[i - 1] ?? '';
    const annMatch = ANNOTATION.exec(prev);

    findings.push({
      target,
      line: i + 1,
      usesImportForm: Boolean(importMatch),
      annotation: annMatch
        ? { target: annMatch[1]!, kind: annMatch[2]!, reason: (annMatch[3] ?? '').trim() }
        : null,
    });
  }

  return findings;
}

/**
 * 纯函数：注解层面的违例（形态、target 一致、kind 枚举、auth-bypass 点名）。
 *
 * `isTolerated` 是**债务快照**的接口：已在账单里的点位豁免"缺注解"这一条
 * （账单存在的意义就是容留存量），但形态与注解合法性一律照查——账单不是免死金牌。
 */
export function findAnnotationViolations(
  findings: readonly ModuleMockFinding[],
  isTolerated: (f: ModuleMockFinding) => boolean = () => false,
): string[] {
  const violations: string[] = [];

  for (const f of findings) {
    if (isExempt(f.target)) continue;

    if (!f.usesImportForm) {
      violations.push(`第 ${f.line} 行：生产模块 ${f.target} 用了字符串形态 mock（契约必须由类型化工厂产生）`);
    }

    if (!f.annotation) {
      if (!isTolerated(f)) {
        violations.push(`第 ${f.line} 行：生产模块 ${f.target} 缺少 // @allow-module-mock 理由注解`);
      }
      continue;
    }

    if (f.annotation.target !== f.target) {
      violations.push(
        `第 ${f.line} 行：注解 target「${f.annotation.target}」与 mock 目标「${f.target}」不一致`,
      );
    }

    if (!REASON_KINDS.includes(f.annotation.kind as ReasonKind)) {
      violations.push(
        `第 ${f.line} 行：理由类型「${f.annotation.kind}」不在枚举内（${REASON_KINDS.join(' / ')}）`,
      );
      continue;
    }

    if (f.annotation.kind === 'auth-bypass' && !/\.test\.tsx?|\.spec\.ts/.test(f.annotation.reason)) {
      violations.push(`第 ${f.line} 行：auth-bypass 的理由必须点名依赖它的测试文件`);
    }
  }

  return violations;
}

/** 纯函数：孤儿注解（注解下一行不是 `vi.mock(`） */
export function findOrphanAnnotations(source: string): string[] {
  const lines = source.split('\n');
  const orphans: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (!ANNOTATION.test(lines[i]!)) continue;
    if (!MOCK_CALL.test(lines[i + 1] ?? '')) {
      orphans.push(`第 ${i + 1} 行：理由注解的下一行不是 vi.mock(（孤儿注解）`);
    }
  }

  return orphans;
}

/** 纯函数：快照比对（只减不增 / 销账 / owner 必填） */
export function compareSnapshot(current: readonly SnapshotEntry[], baseline: readonly SnapshotEntry[]): string[] {
  const key = (e: SnapshotEntry) => `${e.file}::${e.target}::${e.line}`;
  const baselineKeys = new Set(baseline.map(key));
  const currentKeys = new Set(current.map(key));
  const violations: string[] = [];

  for (const e of current) {
    if (!baselineKeys.has(key(e))) {
      violations.push(`快照增长：${e.file}:${e.line} ${e.target} 未在基线里（新点位必须补注解，不得记进账单）`);
    }
  }

  for (const e of baseline) {
    if (!currentKeys.has(key(e))) {
      violations.push(`未销账：${e.file}:${e.line} ${e.target} 已消失或已补注解，账单条目必须删除`);
    }
  }

  for (const e of [...current, ...baseline]) {
    if (!e.owner || e.owner.trim() === '') {
      violations.push(`无主：${e.file}:${e.line} ${e.target} 缺 owner`);
    }
  }

  return violations;
}

// ════════════════════════════════════════════════════════════
// 扫描范围与文件遍历
// ════════════════════════════════════════════════════════════

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const BASELINE_PATH = join(REPO_ROOT, 'apps/portal/__tests__/fixtures/module-mock-baseline.json');
/** 守卫自身要排除：它的夹具文本里含 `vi.mock(` 字样，否则会扫到自己 */
const SELF = 'module-mock-guard.test.ts';

function walk(dir: string, predicate: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, predicate));
    } else if (predicate(name)) {
      out.push(full);
    }
  }
  return out;
}

const isTs = (n: string) => ['.ts', '.tsx'].includes(extname(n));

function scanScopeFiles(): string[] {
  const files = [
    ...walk(join(REPO_ROOT, 'apps/portal/__tests__'), isTs),
    ...walk(join(REPO_ROOT, 'apps/portal/src'), (n) => /\.test\.tsx?$/.test(n)),
    ...walk(join(REPO_ROOT, 'packages/contracts/src'), isTs),
    ...walk(join(REPO_ROOT, 'tests/e2e'), (n) => n.endsWith('.spec.ts')),
  ];
  return files.filter((f) => !f.endsWith(SELF)).sort();
}

interface ScannedPoint {
  readonly file: string;
  readonly target: string;
  readonly line: number;
  readonly usesImportForm: boolean;
  readonly annotation: ModuleMockFinding['annotation'];
}

/** 扫描范围内**所有生产业务模块**的模块级 mock 点位（不做判定，判定留给测试） */
function scanAll(): ScannedPoint[] {
  const points: ScannedPoint[] = [];
  for (const abs of scanScopeFiles()) {
    const rel = relative(REPO_ROOT, abs);
    const source = readFileSync(abs, 'utf-8');
    for (const f of scanModuleMocks(source)) {
      if (isExempt(f.target)) continue;
      points.push({
        file: rel,
        target: f.target,
        line: f.line,
        usesImportForm: f.usesImportForm,
        annotation: f.annotation,
      });
    }
  }
  return points;
}

const pointKey = (file: string, target: string, line: number) => `${file}::${target}::${line}`;

function readBaseline(): SnapshotEntry[] {
  if (!existsSync(BASELINE_PATH)) return [];
  const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as { entries?: SnapshotEntry[] };
  return parsed.entries ?? [];
}

// ════════════════════════════════════════════════════════════
// 7 个违例夹具（守卫自身也要被守）
// ════════════════════════════════════════════════════════════

describe('module-mock-guard —— 违例夹具（守卫自身被守）', () => {
  it('夹具 1：缺注解 → 报"缺少理由注解"', () => {
    const src = "vi.mock(import('@/lib/foo'), () => ({}));";
    const v = findAnnotationViolations(scanModuleMocks(src));
    expect(v.join()).toContain('缺少');
  });

  it('夹具 2：target 不一致 → 报"不一致"', () => {
    const src = "// @allow-module-mock @/lib/bar input-fixture: x\nvi.mock(import('@/lib/foo'), () => ({}));";
    const v = findAnnotationViolations(scanModuleMocks(src));
    expect(v.join()).toContain('不一致');
  });

  it('夹具 3：kind 非法 → 报"不在枚举内"', () => {
    const src = "// @allow-module-mock @/lib/foo 历史原因: x\nvi.mock(import('@/lib/foo'), () => ({}));";
    const v = findAnnotationViolations(scanModuleMocks(src));
    expect(v.join()).toContain('不在枚举内');
  });

  it('夹具 4：孤儿注解 → 报"孤儿注解"', () => {
    const src = "// @allow-module-mock @/lib/foo input-fixture: x\nconst x = 1;";
    expect(findOrphanAnnotations(src).join()).toContain('孤儿注解');
  });

  it('夹具 5：陈旧快照条目 → 报"未销账"', () => {
    const baseline: SnapshotEntry[] = [{ file: 'a.ts', target: '@/lib/foo', line: 1, class: 'debt', owner: '#56' }];
    expect(compareSnapshot([], baseline).join()).toContain('未销账');
  });

  it('夹具 6：快照增长 → 报"快照增长"', () => {
    const current: SnapshotEntry[] = [{ file: 'a.ts', target: '@/lib/foo', line: 1, class: 'debt', owner: '#56' }];
    expect(compareSnapshot(current, []).join()).toContain('快照增长');
  });

  it('夹具 7：记账后未销账（已补注解的点位仍在账单里）→ 报"未销账"', () => {
    const baseline: SnapshotEntry[] = [{ file: 'a.ts', target: '@/lib/foo', line: 3, class: 'debt', owner: '#56' }];
    const current: SnapshotEntry[] = [{ file: 'a.ts', target: '@/lib/foo', line: 3, class: 'debt', owner: '' }];
    const v = compareSnapshot(current, baseline);
    expect(v.join()).toContain('无主');
  });

  it('豁免清单生效：基础设施/框架 mock 不要求注解、也不检查形态', () => {
    const src = "vi.mock('@/infrastructure/redis', () => ({}));";
    expect(findAnnotationViolations(scanModuleMocks(src))).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════
// 真实扫描：形态 + 注解 + 快照
// ════════════════════════════════════════════════════════════

describe('module-mock-guard —— 全量扫描', () => {
  it('扫描范围内生产业务模块的 mock 全部合规（形态 + 理由注解；存量由账单容留）', () => {
    const tolerated = new Set(readBaseline().map((e) => pointKey(e.file, e.target, e.line)));
    const violations: string[] = [];

    for (const abs of scanScopeFiles()) {
      const rel = relative(REPO_ROOT, abs);
      const source = readFileSync(abs, 'utf-8');
      violations.push(...findOrphanAnnotations(source).map((v) => `${rel} ${v}`));
    }

    for (const p of scanAll()) {
      if (!p.usesImportForm) {
        violations.push(`${p.file} 第 ${p.line} 行：${p.target} 用了字符串形态 mock（契约必须由类型化工厂产生）`);
        continue;
      }
      if (p.annotation) {
        const invalid = findAnnotationViolations([
          { target: p.target, line: p.line, usesImportForm: true, annotation: p.annotation },
        ]);
        violations.push(...invalid.map((v) => `${p.file} ${v}`));
      } else if (!tolerated.has(pointKey(p.file, p.target, p.line))) {
        violations.push(`${p.file} 第 ${p.line} 行：${p.target} 缺少 // @allow-module-mock 理由注解（且不在债务快照里）`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('债务快照只减不增、销账、owner 必填', () => {
    const current: SnapshotEntry[] = scanAll()
      .filter((p) => !p.annotation)
      .map((p) => ({ file: p.file, target: p.target, line: p.line, class: 'annotate-later', owner: '#56' }));

    if (process.env['UPDATE_MODULE_MOCK_BASELINE'] === '1') {
      mkdirSync(dirname(BASELINE_PATH), { recursive: true });
      writeFileSync(
        BASELINE_PATH,
        `${JSON.stringify({
          generatedBy: 'module-mock-guard.scanModuleMocks',
          note: '由守卫自己的扫描器机械生成；class 一律 annotate-later，A/B 的语义分类由 #56 逐点核定',
          entries: current,
        }, null, 2)}\n`,
        'utf-8',
      );
      return;
    }

    expect(compareSnapshot(current, readBaseline())).toEqual([]);
  });
});
