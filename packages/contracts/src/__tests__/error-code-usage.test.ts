/**
 * 静态守卫：**每个契约码都必须有发射点或断言**（#82）
 *
 * ## 为什么需要它
 *
 * `packages/contracts/src/errors.ts` 曾定义 **57** 个码，其中 **34 个在源码里零引用**：
 * 客户端（UI、Gateway、第三方 RP、审计）只能**解析中文文案**区分拒绝原因
 * （"有子部门 / 有关联用户 / 是根节点 / 是系统角色 / 不能删自己"），文案一改就静默错配——
 * 与 ADR-018「失败原因可判别」相悖。当时没有任何门禁阻止它继续发生。
 *
 * 本守卫断言：**不存在"定义了但代码里从未引用"的码**（无白名单）。
 * 于是每个新增码都被迫回答一个问题：**谁会发射/消费它？** 答不上来就不该进契约。
 *
 * ## 判据与其边界（如实说明）
 *
 * - 计数范围：`apps/` 与 `packages/` 下的 `.ts/.tsx/.rs`（**不含** `docs/` 与 JSON 夹具）
 *   —— 文档提到某个码**不算**发射点；测试里断言某个码**算**（有断言即有行为）。
 * - 本判据是**代理**：它不能证明"真的有代码在运行时发射它"，只能证明"有人引用它"。
 *   但正是这一层把 34 个死码变成了 0 个——**可检查性比完美性重要**。
 * - 已知边界：若某码只被另一个 `*_ERRORS` 映射表引用（如转换表），也算"被引用"。
 *   这是有意接受的口径：转换表本身就是消费点。
 *
 * @req ADR-018
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根（本文件位于 packages/contracts/src/__tests__） */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', 'target']);
const SCAN_EXTENSIONS = ['.ts', '.tsx', '.rs'] as const;

/** 契约定义文件自身：不算引用 */
const DEFINITION_FILE = join(REPO_ROOT, 'packages/contracts/src/errors.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/** 从契约定义里解析出 `分组 → 码名` 全量清单（与实现同源，不手写第二份） */
function readErrorCodes(): Array<{ group: string; key: string }> {
  const source = readFileSync(DEFINITION_FILE, 'utf-8');
  const codes: Array<{ group: string; key: string }> = [];
  let group: string | null = null;

  for (const line of source.split('\n')) {
    const start = /^export const (\w+_ERRORS) = \{/.exec(line);
    if (start) {
      group = start[1]!;
      continue;
    }
    if (group && (line.trim() === '};' || line.trim() === '} as const;')) {
      group = null;
      continue;
    }
    if (!group) continue;
    const key = /^\s+(\w+):/.exec(line);
    if (key) codes.push({ group, key: key[1]! });
  }

  return codes;
}

describe('契约码必须有引用（#82：死码会让客户端只能解析中文文案）', () => {
  const codes = readErrorCodes();

  it('解析器自测：能从契约定义里读出码清单', () => {
    // 防止解析器静默失灵（那会让下面的断言"永远通过"）
    expect(codes.length).toBeGreaterThan(20);
    expect(codes.some((c) => c.group === 'COMMON_ERRORS' && c.key === 'NOT_FOUND')).toBe(true);
  });

  it('不存在"定义了但代码里零引用"的码', () => {
    const haystack = [join(REPO_ROOT, 'apps'), join(REPO_ROOT, 'packages')]
      .flatMap((root) => walk(root))
      .filter((file) => file !== DEFINITION_FILE)
      .map((file) => readFileSync(file, 'utf-8'))
      .join('\n');

    const unused = codes
      .filter(({ group, key }) => !haystack.includes(`${group}.${key}`))
      .map(({ group, key }) => `${group}.${key}`);

    expect(
      unused,
      `以下契约码在 apps/ 与 packages/ 的 .ts/.tsx/.rs 中零引用：\n  ${unused.join('\n  ')}\n` +
        '⇒ 要么接通（让某个领域规则/路由发射它，并在测试里断言），要么从 contracts 删除。',
    ).toEqual([]);
  });
});
