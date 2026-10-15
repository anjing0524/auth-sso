/**
 * 门禁清单自检 —— **每个 workspace 包都必须真的上过门禁**（retro A1）
 *
 * ## 为什么需要（本会话实测）
 *
 * 根命令是 `pnpm -r lint` / `pnpm -r typecheck`（递归）。**没有脚本的包会被静默跳过**，
 * 而 CI 只跑根命令，于是"这个包能否过 CI"取决于它**上没上清单**：
 *
 * - `packages/contracts` / `packages/config` 曾经**没有 `lint` 脚本** ⇒ 枚举值唯一真相源
 *   的风格问题无人发现（#83）；
 * - `apps/demo-app` 的 lint 曾是 `npx eslint --no-eslintrc . 2>/dev/null || echo 'ok'`
 *   —— **恒绿**，掩盖了"配置本身是坏的（`Cannot find module 'eslint-plugin-import'`）"（#83）。
 *
 * 两条都属同一类：**门禁存在但未接线 / 静默坏掉**——retro 明确说这类"就是发现本身"。
 *
 * ## 它守什么（两条机械规则）
 *
 * 1. **接线**：`apps/*` 与 `packages/*` 的每个包都必须有 `lint` 与 `typecheck` 脚本，
 *    且根脚本必须是递归形式（`pnpm -r …`），否则列表会退化成"我手动敲哪些包"。
 * 2. **不得吞掉失败**：`lint` / `typecheck` 脚本里不得出现会吞掉退出码或错误的写法
 *    （`|| echo …` / `|| true` / `2>/dev/null` / `--no-eslintrc` / `; true` /
 *    `|| exit 0` / `|| :` / `| tee` …）——这些写法让门禁**恒绿**。
 *    **完整且规范性的清单是下方 `FAILURE_SWALLOWING_PATTERNS` 表**，本段只是举例：
 *    §7 要求"声明的范围与实现一致"，所以两处**同进同退**（评审实测过 `; true` 曾被漏掉）。
 *
 * 与 `module-mock-guard.test.ts` 同构：规则本体在文档（本文件 JSDoc + 下方禁令表），
 * 守卫是它的可执行副本，并自带**解析器自测**（扫描失灵会让守卫"永远通过"）。
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// apps/portal/__tests__/api/xxx.test.ts → 上溯 4 层到仓库根
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** 必须上清单的包目录（`apps/*` 与 `packages/*`） */
function workspacePackageDirs(): string[] {
  const dirs: string[] = [];
  for (const group of ['apps', 'packages']) {
    const base = join(ROOT, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgJson = join(base, entry.name, 'package.json');
      if (existsSync(pkgJson)) dirs.push(pkgJson);
    }
  }
  return dirs.sort();
}

/** 会让门禁"恒绿"的写法（禁令表；每条的来历见文件头 JSDoc） */
const FAILURE_SWALLOWING_PATTERNS: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /\|\|\s*echo\b/, why: "`|| echo 'ok'` 让失败变成成功（#83 的 demo-app 假门禁）" },
  { pattern: /\|\|\s*true\b/, why: '`|| true` 吞掉退出码' },
  { pattern: /2>\s*\/dev\/null/, why: '重定向掉 stderr ⇒ 配置坏了也看不见（#83 掩盖了缺 eslint-plugin-import）' },
  { pattern: /--no-eslintrc/, why: 'ESLint 9 flat config 下不是合法参数，必然失败（#83）' },
  // 以下四条是代码评审查出的缺口：文件头声明了禁止"吞掉失败"，但实现只有上面四条 ⇒
  // `eslint . ; true` / `|| exit 0` / `|| :` / `| tee` 都会被判过（"检查看起来在拦、实际拦不住"）。
  { pattern: /;\s*true\b/, why: '`; true` 让脚本以 0 退出（前一条命令的失败被丢弃）' },
  { pattern: /\|\|\s*exit\s+0\b/, why: '`|| exit 0` 把失败改写成成功退出' },
  { pattern: /;\s*exit\s+0\b/, why: '`; exit 0` 把失败改写成成功退出' },
  { pattern: /\|\|\s*:/, why: '`|| :`（shell no-op）丢弃退出码' },
  { pattern: /\|\s*tee\b/, why: '`| tee` 让管道退出码取自 tee，原命令的失败被丢掉' },
];

/** 判定一个脚本是否吞掉失败；返回命中的原因（无命中返回 null） */
function whyScriptSwallowsFailure(script: string): string | null {
  for (const { pattern, why } of FAILURE_SWALLOWING_PATTERNS) {
    if (pattern.test(script)) return why;
  }
  return null;
}

interface PackageReport {
  path: string;
  name: string;
  missing: string[];
  swallowing: string[];
}

function inspectPackages(): PackageReport[] {
  return workspacePackageDirs().map((pkgJsonPath) => {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
      name?: string;
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts ?? {};
    const missing = ['lint', 'typecheck'].filter((s) => !scripts[s]);
    const swallowing: string[] = [];
    for (const s of ['lint', 'typecheck']) {
      const script = scripts[s];
      if (!script) continue;
      const why = whyScriptSwallowsFailure(script);
      if (why) swallowing.push(`${s}: ${why}（实际：${script}）`);
    }
    return {
      path: pkgJsonPath.replace(`${ROOT}/`, ''),
      name: pkg.name ?? '(未命名)',
      missing,
      swallowing,
    };
  });
}

describe('门禁清单自检（retro A1）', () => {
  it('每个 workspace 包都有 lint 与 typecheck 脚本', () => {
    const reports = inspectPackages();

    // 解析器自测：一个包都没扫到 ⇒ 守卫会"永远通过"
    expect(reports.length, '未扫描到任何 workspace 包，扫描逻辑失效').toBeGreaterThanOrEqual(4);

    const offending = reports.filter((r) => r.missing.length > 0);
    expect(
      offending.map((r) => `${r.path} (${r.name}) 缺少：${r.missing.join('、')}`),
      '有包没上根递归命令的清单 ⇒ `pnpm -r lint/typecheck` 会静默跳过它（#83）',
    ).toEqual([]);
  });

  it('根 lint/typecheck 必须是递归形式（否则清单不生效）', () => {
    const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = rootPkg.scripts ?? {};
    for (const key of ['lint', 'typecheck'] as const) {
      expect(scripts[key], `根 package.json 缺少 ${key}`).toBeDefined();
      expect(
        scripts[key],
        `根 ${key} 必须是递归（pnpm -r …），否则各包的脚本不会被跑到`,
      ).toMatch(/pnpm\s+(-r|--recursive)\s/);
    }
  });

  it('lint/typecheck 脚本不得吞掉失败（否则门禁恒绿）', () => {
    const offenders: string[] = [];
    for (const report of inspectPackages()) {
      for (const hit of report.swallowing) offenders.push(`${report.path}: ${hit}`);
    }
    expect(
      offenders,
      '这些脚本会把失败伪装成成功——要跳过就写进清单并说明，别用重定向',
    ).toEqual([]);
  });

  // ── 违例夹具：证明"吞掉失败"的判定真的会红（而不是永远通过）──────────────
  describe('判定夹具（守卫自身的自检）', () => {
    const shouldBeRejected = [
      "npx eslint --no-eslintrc . 2>/dev/null || echo 'ok'",
      'eslint . || true',
      'eslint . 2>/dev/null',
      'eslint --no-eslintrc .',
      'eslint . ; true',
      'eslint . || exit 0',
      'eslint .; exit 0',
      'eslint . || :',
      'eslint . | tee lint.log',
    ];
    for (const script of shouldBeRejected) {
      it(`拒绝：${script}`, () => {
        expect(whyScriptSwallowsFailure(script)).not.toBeNull();
      });
    }

    for (const script of ['eslint .', 'tsc --noEmit', 'eslint . && tsc --noEmit']) {
      it(`接受：${script}`, () => {
        expect(whyScriptSwallowsFailure(script)).toBeNull();
      });
    }
  });
});
