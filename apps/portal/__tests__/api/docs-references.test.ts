/**
 * 引导文件里的路径指引必须能解析（确定性检查）
 *
 * ## 为什么
 *
 * `AGENTS.md` / `CLAUDE.md` 会被推到**每一个**代理的上下文里，其中的 `@/…` 是
 * **导航指针**。指针指向一个不存在的文件时，代理会照着一个幻觉去写代码——#58 实测到
 * 两处：`@/lib/redis` 与 `@/lib/auth-middleware`（真身分别是 `@/infrastructure/redis`
 * 与 `@/lib/auth`），且同段的"API 层测试（Mock DB/Redis）"描述的还是 ADR-022 明令
 * 治理掉的形态。
 *
 * 这是"**把机械性违规做成确定性检查**"的一例：路径能不能解析，没有判断题的余地。
 *
 * ## 为什么扫描范围**不含** `docs/adr/**`
 *
 * ADR 是**历史记录**：它们引用当年的路径，正是决策的一部分（例如"`@/lib/redis` 曾
 * 是 Redis 入口，后收口到 `@/infrastructure/redis`"）。把历史记录也纳入"必须存在"
 * 的约束，等于逼人改写历史。所以范围只含**指向当下的导航文件**。
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** `@/` 别名根（apps/portal/tsconfig.json 的 paths） */
const ALIAS_ROOT = join(REPO_ROOT, 'apps/portal/src');

/** 指向当下的导航文件（ADR / 历史文档 **不在**此列，见文件头） */
function steeringFiles(): string[] {
  const fixed = ['AGENTS.md', 'CLAUDE.md', 'apps/portal/CLAUDE.md'];
  const agentsDir = join(REPO_ROOT, 'docs/agents');
  const extra = existsSync(agentsDir)
    ? readdirSync(agentsDir).filter((n) => n.endsWith('.md')).map((n) => `docs/agents/${n}`)
    : [];
  return [...fixed, ...extra]
    .map((rel) => join(REPO_ROOT, rel))
    .filter((abs) => existsSync(abs));
}

/** 从一段文本里抽出 `@/…` 路径令牌（去掉通配与尾部标点） */
export function extractAliasPaths(source: string): string[] {
  const tokens = source.match(/@\/[A-Za-z0-9._/-]+/g) ?? [];
  return [...new Set(tokens.map((t) => t.replace(/[.,;:)\]]+$/, '')))];
}

/** 该 `@/…` 路径是否解析到真实文件或目录 */
export function resolves(token: string): boolean {
  const rel = token.slice(2); // 去掉 `@/`
  const base = join(ALIAS_ROOT, rel);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  return candidates.some((c) => existsSync(c));
}

describe('引导文件里的 @/ 路径指引', () => {
  it('抽取器本身可信（能抓到已知的坏指针、且去掉尾部标点）', () => {
    expect(extractAliasPaths('见 `@/lib/redis`，以及 `@/lib/auth`。')).toEqual(['@/lib/redis', '@/lib/auth']);
  });

  it('扫描范围非空（否则这条检查是假绿）', () => {
    const files = steeringFiles();
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(files.some((f) => f.endsWith('CLAUDE.md'))).toBe(true);
  });

  it('每个 @/ 路径都能解析到真实文件', () => {
    const violations: string[] = [];
    let scanned = 0;

    for (const abs of steeringFiles()) {
      const rel = relative(REPO_ROOT, abs);
      const source = readFileSync(abs, 'utf-8');
      scanned += 1;
      for (const token of extractAliasPaths(source)) {
        if (!resolves(token)) {
          violations.push(`${rel}: \`${token}\` 未解析到 apps/portal/src 下的真实文件`);
        }
      }
    }

    expect(scanned).toBeGreaterThanOrEqual(4);
    expect(violations).toEqual([]);
  });
});

/**
 * `docs/solution/README.md` 是**决策索引**（导航指针）：任何一篇 solution 文档都必须
 * 能从它到达——否则"这件事以前有人做过吗"只能靠 grep（retro C1：本会话问了 6 次）。
 *
 * 索引**会腐坏**（新文档写完就忘），所以这条断言是它唯一的维护机制。
 */
describe('docs/solution 决策索引的完整性', () => {
  it('索引存在，且链接到 docs/solution 下的每一篇文档', () => {
    const index = join(REPO_ROOT, 'docs/solution/README.md');
    expect(existsSync(index), 'docs/solution/README.md 不存在（决策索引缺失）').toBe(true);
    const text = readFileSync(index, 'utf-8');

    const docs = readdirSync(join(REPO_ROOT, 'docs/solution')).filter(
      (n) => n.endsWith('.md') && n !== 'README.md',
    );
    // 扫描范围非空（否则这条检查是假绿）
    expect(docs.length).toBeGreaterThanOrEqual(50);

    const unlinked = docs.filter((n) => !text.includes(`(${n})`));
    expect(
      unlinked,
      '这些 solution 文档没有被索引链接——新增文档时请把它挂到 README 的某个主题下',
    ).toEqual([]);

    // 每篇**恰好**挂一次（此前只查"能到达"，重复链接没人管；README 却声称"无重复"）
    const duplicated = docs.filter((n) => text.split(`(${n})`).length - 1 !== 1);
    expect(duplicated, '这些文档在索引里出现 0 次或多次').toEqual([]);

    // 声明里的篇数必须等于实测（此前写死"64 篇"，新增几篇后就悄悄过期）
    const declared = /全部 \*\*(\d+) 篇\*\*文档/.exec(text);
    expect(declared, 'README 里缺少「全部 **N 篇**文档」的声明').not.toBeNull();
    expect(Number(declared![1]), 'README 声明的篇数与实际不符').toBe(docs.length);
  });
});
