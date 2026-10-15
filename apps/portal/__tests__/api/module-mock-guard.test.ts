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
 * 3. **工厂形态（#91 / A2 修订版）**：注解类型为 `Partial<typeof X>` 的工厂**必须**
 *    调 `importOriginal()`（配 `...actual` spread）——否则未列出的导出在替身里是
 *    `undefined`，生产代码一用到就**运行时炸、`tsc` 不报**（本会话踩了 5 次：
 *    R6/R13/R16/R18/R33）。本意就是**整体替换**的替身（UI 原语 stub 等）
 *    必须把 kind 写成 **`full-replacement`**，把意图写明。
 *
 * ## 为什么这样写（而不是 ESLint 规则 / 手写键集扫描）
 *
 * - 键集与判别式形状**交给编译器**（类型化工厂 + `pnpm typecheck`），本守卫只管
 *   类型系统表达不了的那一半："为什么允许 mock 这个模块"（ADR-022 §4(a)/(d)）；
 * - 守卫自身也**被守**：**14 个违例夹具**（缺注解 / 注解 target 与生产 mock 不一致 /
 *   kind 非法 / 孤儿注解 / auth-bypass 未点名 / 注释引用不算点位 / 豁免清单生效 /
 *   注解贴到**豁免** mock 上 / 不得跨条串味 / 目标无法识别）
 *   外加 1 条全量扫描断言，一起在 CI 里真跑（#91 又补了工厂形态的 4 个夹具）。
 *
 * ## 债务快照机制**已撤除**（#56）
 *
 * #54 上线时本守卫带一份 `__tests__/fixtures/module-mock-baseline.json`（48 条
 * "annotate-later" 存量，owner #56），用于"只减不增"地治理存量。**#56 已把这 48 条
 * 逐条结清**（补合法注解 / 去掉恒等替身改走真实实现），因此快照文件、快照比对函数
 * 与快照相关夹具**全部删除**——规则里**不留永久白名单**：今天之后，任何新增的生产
 * 模块 mock 都必须**当场**给出理由，没有"先记账、以后再还"的通道。
 *
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
  // 外部 UI 原语（与 cmdk 同类）：toast 库由组件测试整体替换
  'sonner',
  '@auth-sso/',
  '@/lib/env',
  '@/lib/logger',
] as const;

/** 理由类型封闭枚举（ADR-022 §4(b)） */
export const REASON_KINDS = [
  'infra-boundary',
  'input-fixture',
  'fault-injection',
  'auth-bypass',
  /**
   * 本意就是**整体替换**整个模块（例如 UI 原语 stub：真实组件是 forwardRef，
   * 无法在 jsdom 里当替身用）。声明它之后，工厂**不必** `importOriginal`——
   * 但必须写明理由，让"整体替换"是**声明**而不是猜测。
   */
  'full-replacement',
] as const;
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

/**
 * 提取某个 `vi.mock(` 的目标说明符；首参允许换行，但**不得跨入下一条 mock 或注解**。
 *
 * 实测教训：早先用「本行 + 后两行」的窗口，会把**下一条** mock 的目标算到上一条头上
 * （表现为给豁免的 redis mock 安上 `@/domain/auth/password` 的目标），并进而产生
 * "同一条 mock 记两笔"的幽灵账单条目。
 */
function extractMockTarget(lines: readonly string[], i: number): { target: string; usesImportForm: boolean } | null {
  for (let j = i; j < Math.min(i + 3, lines.length); j += 1) {
    const text = lines[j]!;
    if (j > i && (MOCK_CALL.test(text) || ANNOTATION.test(text))) break;
    const importMatch = IMPORT_FORM.exec(text);
    if (importMatch) return { target: importMatch[1]!, usesImportForm: true };
    const stringMatch = STRING_FORM.exec(text);
    if (stringMatch) return { target: stringMatch[1]!, usesImportForm: false };
  }
  return null;
}

/** 纯函数：扫一段源码里的模块级 mock + 其上一行的理由注解（跳过注释里的引用文字） */
export function scanModuleMocks(source: string): ModuleMockFinding[] {
  const lines = source.split('\n');
  const findings: ModuleMockFinding[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!MOCK_CALL.test(line)) continue;
    if (isCommentLine(line)) continue;

    const found = extractMockTarget(lines, i);
    if (!found) continue;

    const prev = lines[i - 1] ?? '';
    const annMatch = ANNOTATION.exec(prev);

    findings.push({
      target: found.target,
      line: i + 1,
      usesImportForm: found.usesImportForm,
      annotation: annMatch
        ? { target: annMatch[1]!, kind: annMatch[2]!, reason: (annMatch[3] ?? '').trim() }
        : null,
    });
  }

  return findings;
}

/**
 * 纯函数：注解层面的违例（形态、kind 枚举、auth-bypass 点名）。
 *
 * target 一致性**不在这里判**——由 `findAnnotationBindingViolations` 独占（那条还覆盖豁免
 * mock），否则同一处错位会产出两条措辞不同的违例，且两条判定日后各自演化。
 */
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

/**
 * 纯函数：注解**绑定性**检查——注解必须紧贴一个 `vi.mock(`，且 target 逐字一致。
 *
 * 为什么连**豁免** mock 也要查：实测过一条漏网注解——`@/domain/auth/password` 的注解
 * 被插到了下一行的 `vi.mock('@/infrastructure/redis')`（豁免模块）之上。豁免模块的目标
 * 不参与"是否必须给理由"的判定，但**注解与目标的绑定关系**必须成立，否则注解会
 * 静默指错对象（读的人以为它管的是别的模块）。
 */
export function findAnnotationBindingViolations(source: string): string[] {
  const lines = source.split('\n');
  const violations: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const annMatch = ANNOTATION.exec(lines[i]!);
    if (!annMatch) continue;

    const next = lines[i + 1] ?? '';
    if (!MOCK_CALL.test(next)) {
      violations.push(`第 ${i + 1} 行：理由注解的下一行不是 vi.mock(（孤儿注解）`);
      continue;
    }

    const found = extractMockTarget(lines, i + 1);
    if (!found) {
      violations.push(`第 ${i + 1} 行：无法识别 vi.mock 的目标说明符（首参不在 3 行窗口内，或用了非单引号形式）`);
      continue;
    }
    if (found.target !== annMatch[1]) {
      violations.push(
        `第 ${i + 1} 行：注解 target「${annMatch[1]}」与下一行 vi.mock 目标「${found.target}」不一致（注解贴错位置）`,
      );
    }
  }

  return violations;
}

/**
 * 纯函数：工厂**形态**违例（#91 / A2 修订版）。
 *
 * `Partial<typeof X>` 只约束"键集 ⊆"，**不要求完整**：工厂少列一个导出，
 * 它在替身里就是 `undefined`——生产代码用到时才炸，且 `tsc` 不报。
 *
 * 规则：`Partial<typeof` + 无 `importOriginal` + kind ≠ `full-replacement` ⇒ 违例。
 * （整体替换是**合法**的，但必须声明；见 `REASON_KINDS` 里那条的说明。）
 */
export function findFactoryShapeViolations(source: string): string[] {
  const lines = source.split('\n');
  const violations: string[] = [];

  for (const f of scanModuleMocks(source)) {
    if (isExempt(f.target)) continue;
    // 缺注解 / kind 非法由 findAnnotationViolations 独占报错，这里不重复报
    if (!f.annotation || !REASON_KINDS.includes(f.annotation.kind as ReasonKind)) continue;
    if (f.annotation.kind === 'full-replacement') continue;

    const lineOffset = lines.slice(0, f.line - 1).reduce((n, l) => n + l.length + 1, 0);
    const start = source.indexOf('vi.mock(', lineOffset);
    if (start < 0) continue;
    const block = balancedBlock(source, start);

    if (/Partial<typeof/.test(block) && !/importOriginal/.test(block)) {
      violations.push(
        `第 ${f.line} 行：${f.target} 的工厂注解为 Partial<typeof …> 却未调 importOriginal`
          + '（未列出的导出会是 undefined，运行时炸、tsc 不报）。'
          + '修法二选一：① async (importOriginal) + { ...(await importOriginal()), … }；'
          + '② 若本意就是整体替换，把 kind 改成 full-replacement 并写明理由',
      );
    }
  }

  return violations;
}

/**
 * 取从 `vi.mock(` 起点开始的**完整实参块**（括号配平）。
 *
 * 为什么不用"扫到 `}));` 行"的启发式：相邻 mock 会被串进同一窗口，
 * 上一个 mock 的 `Partial<typeof` 就栽到下一个头上（#91 实测的假阳性来源）。
 */
export function balancedBlock(source: string, startIndex: number): string {
  let depth = 0;
  let quote: string | null = null;
  let i = startIndex;
  for (; i < source.length; i += 1) {
    const ch = source[i]!;
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
  }
  return source.slice(startIndex, i);
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

  it('夹具 2：注解 target 与 mock 目标不一致 → 报"贴错位置"（判定收敛在绑定性检查一处）', () => {
    const src = "// @allow-module-mock @/lib/bar input-fixture: x\nvi.mock(import('@/lib/foo'), () => ({}));";
    expect(findAnnotationBindingViolations(src).join()).toContain('贴错位置');
  });

  it('夹具 3：kind 非法 → 报"不在枚举内"', () => {
    const src = "// @allow-module-mock @/lib/foo 历史原因: x\nvi.mock(import('@/lib/foo'), () => ({}));";
    const v = findAnnotationViolations(scanModuleMocks(src));
    expect(v.join()).toContain('不在枚举内');
  });

  it('夹具 4：孤儿注解 → 报"孤儿注解"', () => {
    const src = "// @allow-module-mock @/lib/foo input-fixture: x\nconst x = 1;";
    expect(findAnnotationBindingViolations(src).join()).toContain('孤儿注解');
  });

  it('夹具 10：目标说明符无法识别（非单引号）→ 显式报错而非静默放过', () => {
    const src = '// @allow-module-mock @/lib/foo input-fixture: x\nvi.mock(`@/lib/foo`, () => ({}));';
    expect(findAnnotationBindingViolations(src).join()).toContain('无法识别');
  });

  it('夹具 9：不得把下一条 mock 的目标算到上一条（跨条串味）', () => {
    const src = [
      "vi.mock('@/infrastructure/redis', () => ({}));",
      "// @allow-module-mock @/domain/auth/password input-fixture: x",
      "vi.mock(import('@/domain/auth/password'), () => ({}));",
    ].join('\n');
    const found = scanModuleMocks(src);
    expect(found.map((f) => f.target)).toEqual(['@/infrastructure/redis', '@/domain/auth/password']);
    expect(findAnnotationBindingViolations(src)).toEqual([]);
  });

  it('夹具 8：注解贴到**豁免** mock 上（target 不匹配）→ 报"贴错位置"', () => {
    const src =
      "// @allow-module-mock @/domain/auth/password input-fixture: x\nvi.mock('@/infrastructure/redis', () => ({}));";
    expect(findAnnotationBindingViolations(src).join()).toContain('贴错位置');
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

  // ── #91 新增：工厂形态（Partial 必须 importOriginal，或声明 full-replacement）──
  it('夹具 11：Partial 工厂缺 importOriginal → 报"未调 importOriginal"（附两种修法）', () => {
    const src = [
      '// @allow-module-mock @/lib/audit input-fixture: 只提供审计写入输入',
      String.raw`vi.mock(import('@/lib/audit'), (): Partial<typeof auditModule> => ({`,
      '  appendSecurityAudit: vi.fn(),',
      '}));',
    ].join('\n');
    const v = findFactoryShapeViolations(src).join();
    expect(v).toContain('未调 importOriginal');
    expect(v).toContain('full-replacement');
  });

  it('夹具 12：Partial + importOriginal → 通过（部分替换的正解）', () => {
    const src = [
      '// @allow-module-mock @/lib/auth input-fixture: 只提供"谁已登录"这一输入',
      String.raw`vi.mock(import('@/lib/auth'), async (importOriginal): Promise<Partial<typeof authModule>> => {`,
      '  const actual = await importOriginal();',
      '  return { ...actual, withAuth: vi.fn() };',
      '});',
    ].join('\n');
    expect(findFactoryShapeViolations(src)).toEqual([]);
  });

  it('夹具 13：full-replacement 声明 → 通过（整体替换必须声明，不是被禁止）', () => {
    const src = [
      '// @allow-module-mock @/components/ui/command full-replacement: UI 原语 stub，真实组件是 forwardRef',
      String.raw`vi.mock(import('@/components/ui/command'), (): Partial<typeof commandModule> =>`,
      '  asComponentStubs<typeof commandModule>({}));',
    ].join('\n');
    expect(findFactoryShapeViolations(src)).toEqual([]);
  });

  it('夹具 14：不得把相邻 mock 串成同一窗口（括号配平）', () => {
    const src = [
      '// @allow-module-mock @/lib/permissions input-fixture: 只提供刷新结果',
      String.raw`vi.mock(import('@/lib/permissions'), async (importOriginal): Promise<Partial<typeof permissionsModule>> => {`,
      '  const actual = await importOriginal();',
      '  return { ...actual, refreshUsersPermissionCache: vi.fn() };',
      '});',
      '// @allow-module-mock @/lib/session/revoke input-fixture: 只提供批量撤销结果',
      String.raw`vi.mock(import('@/lib/session/revoke'), (): Partial<typeof sessionRevokeModule> => ({ revokeUsersAccessByUserId: vi.fn() }));`,
    ].join('\n');
    const v = findFactoryShapeViolations(src);
    expect(v.length).toBe(1);
    expect(v[0]).toContain('@/lib/session/revoke');
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
      violations.push(...findAnnotationBindingViolations(source).map((v) => `${rel} ${v}`));
      violations.push(...findAnnotationViolations(scanModuleMocks(source)).map((v) => `${rel} ${v}`));
      violations.push(...findFactoryShapeViolations(source).map((v) => `${rel} ${v}`));
    }
    expect(violations).toEqual([]);
  });
});
