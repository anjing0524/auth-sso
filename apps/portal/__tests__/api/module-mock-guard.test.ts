/**
 * 模块级 mock 守卫 —— 规则的**可执行副本**（ADR-022 §4(b)(c)(d)）
 *
 * ## 它守什么
 *
 * 1. **契约（形态）**：生产业务模块的模块级 mock 必须是类型化工厂
 *    （`vi.mock(import('x'), …)`）。字符串形态 `vi.mock('x', …)` 不再被接受——
 *    它不产生任何编译期契约（#51 实测：幽灵键**零诊断**）。
 * 2. **理由（注解）**：生产业务模块的模块级 mock 必须带
 *    `// @allow-module-mock <target> <reason-kind>: <理由>`，注解在 `vi.mock(` 的
 *    **上一行**、target 逐字一致、kind ∈ 封闭枚举；`auth-bypass` 必须在理由里
 *    **点名**依赖它的测试文件。
 *
 * ## 为什么这样写（而不是 ESLint 规则 / 手写键集扫描）
 *
 * - 键集与判别式形状**交给编译器**（类型化工厂 + `pnpm typecheck`），本守卫只管
 *   类型系统表达不了的那一半："为什么允许 mock 这个模块"（ADR-022 §4(a)/(d)）；
 * - 守卫自身也**被守**：违例夹具（缺注解 / target 不一致 / kind 非法 / 孤儿注解 /
 *   auth-bypass 未点名 / 注释引用不算点位 / 豁免生效）在 CI 里真跑。
 *
 * ## 债务快照机制**已撤除**（#56）
 *
 * #54 上线时本守卫带一份 `__tests__/fixtures/module-mock-baseline.json`（48 条
 * "annotate-later" 存量，owner #56），用于"只减不增"地治理存量。**#56 已把这 48 条
 * 逐条结清**（补合法注解 / 去掉恒等替身改走真实实现），因此快照文件、快照比对函数
 * 与快照相关夹具**全部删除**——规则里**不留永久白名单**：今天之后，任何新增的生产
 * 模块 mock 都必须**当场**给出理由，没有"先记账、以后再还"的通道。
 *
 * @req H-ACL-001
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
 * 实测必要性：`audit-retry`/`fixture-keypair`/`gateway-identity-trust`/`seed-fixtures`
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

/** 纯函数：注解层面的违例（形态、target 一致、kind 枚举、auth-bypass 点名） */
export function findAnnotationViolations(findings: readonly ModuleMockFinding[]): string[] {
  const violations: string[] = [];

  for (const f of findings) {
    if (isExempt(f.target)) continue;

    if (!f.usesImportForm) {
      violations.push(`第 ${f.line} 行：生产模块 ${f.target} 用了字符串形态 mock（契约必须由类型化工厂产生）`);
    }

    if (!f.annotation) {
      violations.push(`第 ${f.line} 行：生产模块 ${f.target} 缺少 // @allow-module-mock 理由注解`);
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

// ════════════════════════════════════════════════════════════
// 扫描范围与文件遍历
// ════════════════════════════════════════════════════════════

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
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

// ════════════════════════════════════════════════════════════
// 违例夹具（守卫自身也要被守）
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

  it('夹具 5：auth-bypass 未点名测试文件 → 报"必须点名"', () => {
    const src = "// @allow-module-mock @/lib/auth auth-bypass: 绕过登录\nvi.mock(import('@/lib/auth'), () => ({}));";
    const v = findAnnotationViolations(scanModuleMocks(src));
    expect(v.join()).toContain('必须点名');
  });

  it('夹具 6：注释里引用的 vi.mock( 不算点位（否则文档叙述会误报）', () => {
    const src = " * 过去用 `vi.mock('@/lib/auth/token')` 整体替换签发\n";
    expect(scanModuleMocks(src)).toEqual([]);
  });

  it('夹具 7：豁免清单生效：基础设施/框架 mock 不要求注解、也不检查形态', () => {
    const src = "vi.mock('@/infrastructure/redis', () => ({}));";
    expect(findAnnotationViolations(scanModuleMocks(src))).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════
// 真实扫描：形态 + 注解（无白名单）
// ════════════════════════════════════════════════════════════

describe('module-mock-guard —— 全量扫描', () => {
  it('扫描范围内生产业务模块的 mock 全部当场给出合法理由（形态 + 注解，无白名单）', () => {
    const violations: string[] = [];
    for (const abs of scanScopeFiles()) {
      const rel = relative(REPO_ROOT, abs);
      const source = readFileSync(abs, 'utf-8');
      violations.push(...findOrphanAnnotations(source).map((v) => `${rel} ${v}`));
      violations.push(...findAnnotationViolations(scanModuleMocks(source)).map((v) => `${rel} ${v}`));
    }
    expect(violations).toEqual([]);
  });
});
