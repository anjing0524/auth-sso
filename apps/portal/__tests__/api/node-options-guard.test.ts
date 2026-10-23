/**
 * 守卫：`NODE_OPTIONS` 必须被当前 Node 接受（2026-10-19 的 Portal 起不来事故）
 *
 * ## 背景（真事故，不是假想）
 *
 * `apps/portal` 的 `dev`/`start` 曾写 `NODE_OPTIONS='--harmony-temporal' next dev`。
 * node@26 **拒绝** `NODE_OPTIONS` 里的 V8 旗标 ⇒ `pnpm dev` 起不来 ✗。
 * 更隐蔽的是：即使把旗标移到 node 命令行，**Next.js 仍会把 execArgv 重新序列化进
 * 子进程的 `NODE_OPTIONS`**（`next/dist/lib/worker.js:84` 的 `NODE_OPTIONS: formattedNodeOptions`）
 * ⇒ 同一个错误照旧 ✗。根因是"把 V8 旗标交给环境变量"这件事本身。
 *
 * ## 判据（运行时，不靠分类猜测）
 *
 * 对本仓每个 workspace 的 `package.json` 里出现的每个 `NODE_OPTIONS=<值>`，
 * 在**该包目录**下真跑一次 `NODE_OPTIONS=<值> node -e ""` ⇒ 退出码必须为 0。
 * 被 Node 拒绝的写法（如 `--harmony-*`）当场变红；合法的（如 `--require`、
 * `--max-old-space-size`）照常通过。
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, walk } from '../helpers/repo-scan';

/**
 * 收集所有 workspace 的 package.json 路径（根 + apps/* + packages/*）。
 *
 * 必须跳过构建产物：宿主若执行过 `next build`，`apps/portal/.next/standalone/` 下会有
 * 一份**产物副本**的 package.json（其 scripts 引用的 `./scripts/preload-mock.cjs` 不在
 * standalone 目录里 ⇒ 真跑 node 必失败）。那是构建产物而非 workspace 声明，扫描它会产生
 * 假红（2026-10-23 实测：干净检出全绿、宿主 build 后 1 failed）。
 */
const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage', 'target']);

function packageJsonPaths(): string[] {
  const isPkgJson = (name: string) => name === 'package.json';
  return [
    join(REPO_ROOT, 'package.json'),
    ...walk(join(REPO_ROOT, 'apps'), isPkgJson, SKIP_DIRS),
    ...walk(join(REPO_ROOT, 'packages'), isPkgJson, SKIP_DIRS),
  ];
}

/** 从 scripts 里抽出所有 NODE_OPTIONS=<值> 取值 */
function nodeOptionsValues(pkgPath: string): Array<{ script: string; value: string }> {
  const { scripts = {} } = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
  const found: Array<{ script: string; value: string }> = [];
  for (const [script, cmd] of Object.entries(scripts)) {
    for (const m of cmd.matchAll(/NODE_OPTIONS=('[^']*'|"[^"]*"|[^\s]+)/g)) {
      found.push({ script, value: m[1]!.replace(/^['"]|['"]$/g, '') });
    }
  }
  return found;
}

describe('NODE_OPTIONS 必须被当前 Node 接受', () => {
  it('每个 workspace 的每个 NODE_OPTIONS 取值都能让 node 启动', () => {
    const entries = packageJsonPaths().flatMap((pkg) =>
      nodeOptionsValues(pkg).map((v) => ({ pkg, dir: join(pkg, '..'), ...v })),
    );
    // 反空转：必须真的扫到了若干 package.json；但**允许 NODE_OPTIONS 出现 0 次**
    // （那意味着没有任何取值可被拒绝，本来就是通过态；否则唯一项被合法移除时会假红）。
    const pkgs = packageJsonPaths();
    expect(pkgs.length, `实测扫描到 ${pkgs.length} 个 package.json`).toBeGreaterThanOrEqual(3);

    const failures: string[] = [];
    for (const e of entries) {
      try {
        execFileSync(process.execPath, ['-e', ''], { cwd: e.dir, env: { ...process.env, NODE_OPTIONS: e.value }, stdio: 'pipe' });
      } catch (err) {
        const msg = err instanceof Error ? String(err.message).split('\n')[0] : String(err);
        failures.push(`${e.pkg} 的 script「${e.script}」: NODE_OPTIONS=${e.value} ⇒ 被 node 拒绝（${msg}）`);
      }
    }
    expect(failures.join('\n'), '有 NODE_OPTIONS 取值会被当前 Node 拒绝').toBe('');
  });
});
