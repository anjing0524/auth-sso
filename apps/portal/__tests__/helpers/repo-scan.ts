/**
 * 仓库形状与文件遍历的**唯一定义**（所有静态守卫共用）
 *
 * ## 为什么（架构巡检候选 2 · Top 推荐）
 *
 * 本仓有一族"把机械性违规做成确定性检查"的静态守卫（`apps/portal/__tests__/api/*guard.test.ts`、
 * `__tests__/api/docs-*.test.ts`、`packages/contracts/src/__tests__/error-code-usage.test.ts`）。
 * 巡检实测：它们各自算仓库根、各自 walk 文件、各自断言"扫描范围非空"——
 *
 * - `__tests__/api/` → 上溯 4 层到仓库根：**6 份**（`REPO_ROOT` / `ROOT` 两个名字）
 * - `walk`：**5 份**（其中一份在另一个 package 里）
 * - `isCommentLine`：**2 份**（第二份的注释还写着"教训来自 module-mock-guard"）
 *
 * `isCommentLine` 是「跳不跳注释」的判定——本仓最容易出假绿/假红的语义（在注释里**叙述**某个
 * 模式是常态：解释"为什么不能用它"、记录"此前是这么写的"）。同一个安全语义抄两遍，
 * 第二遍只能靠注释提醒第一遍 ⇒ 这是 **locality** 的缺失。
 *
 * ## 接口（小，且是守卫真正需要的那几件事）
 *
 * 守卫保留的只有："一段源码 → 违例清单"的纯函数 + 扫描范围的声明。
 *
 * @module apps/portal/__tests__/helpers/repo-scan
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 从 `start` 向上找到仓库根（含 `pnpm-workspace.yaml` 的那一层）。
 *
 * 用"向上找标志文件"而不是"上溯 N 层"：那个 N 曾在 6 处各写一遍，且**随目录调整而静默失效**
 * （本仓真的把守卫从 `test-support/` 移到 `__tests__/helpers/` 时就会全部失效）。
 *
 * 也**不要用 `process.cwd()`**：vitest 的 cwd 与 project root 不一致（实测）。
 */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 16; i += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`无法从 ${start} 向上找到 pnpm-workspace.yaml —— 仓库结构变了？`);
}

/** 本仓库根（所有守卫共用同一处定义） */
export const REPO_ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

/**
 * 该行是否处在注释里。
 *
 * @param line      源码行
 * @param codeToken 可选：该行里"模式"的标识（如 `vi.mock(`）。给了它时，
 *                  还会判断 `codeToken` 之前是否有 `//`（`const x = 1; // vi.mock(` 这类）。
 */
export function isCommentLine(line: string, codeToken?: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return true;
  if (!codeToken) return false;
  const at = line.indexOf(codeToken);
  return at > 0 && line.slice(0, at).includes('//');
}

/**
 * 去掉注释后再匹配（守卫只看**代码**）。
 *
 * 修掉某个形状的文件往往会在注释里写下"此前是这么写的"作为修复记录；若把注释算进去，
 * 守卫会把"解释这个形状的文档"当成缺陷本身（本仓实测踩到过）。
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * 递归收集满足 `isTarget` 的文件（返回绝对路径）
 *
 * @param skipDirs 需要整棵跳过的目录名（如 `node_modules` / `.next`）
 *
 * 目录不存在时返回空数组（不是抛错）：`tests/e2e` 这类目录在部分检出里可能缺失，
 * 由调用方的 `assertScannedNonEmpty` 负责"空即假绿"的判定。
 */
export function walk(
  dir: string,
  isTarget: (name: string) => boolean,
  skipDirs: ReadonlySet<string> = new Set(),
): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.isDirectory()) {
      if (skipDirs.has(name.name)) continue;
      out.push(...walk(join(dir, name.name), isTarget, skipDirs));
    } else if (isTarget(name.name)) {
      out.push(join(dir, name.name));
    }
  }
  return out;
}

/** 递归收集 `.ts` / `.tsx`；默认排除测试文件自身 */
export function tsFiles(dir: string, options: { includeTests?: boolean } = {}): string[] {
  const includeTests = options.includeTests ?? false;
  return walk(dir, (name) => {
    if (!name.endsWith('.ts') && !name.endsWith('.tsx')) return false;
    return includeTests || !/\.test\.tsx?$/.test(name);
  });
}

/**
 * 扫描范围非空断言 —— "否则这条检查是假绿"。
 *
 * 每个守卫都得写一次（阈值还各写各的：`≥50` / `≥4` / `≥3`），于是"空扫描通过"这种假绿
 * 只能靠作者记得加。收进这里之后：**所有**守卫共用同一条防线与同一句可操作的消息。
 */
export function assertScannedNonEmpty<T>(
  items: readonly T[],
  what: string,
  min = 1,
): void {
  if (items.length < min) {
    throw new Error(
      `扫描范围为空或过小：${what}（实测 ${items.length}，期望 ≥ ${min}）`
        + '——这是"检查在假绿"的信号，先确认扫描路径与过滤条件，别放宽阈值',
    );
  }
}
