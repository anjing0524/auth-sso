/**
 * 守卫事务不得空转 —— `withScopedWrite(..., async () => undefined)` 是**零守卫**
 *
 * ## 这个形状为什么危险
 *
 * `withScopedWrite` 的语义是「快照 → 断言 → **在同一事务内执行 handler**」。
 * 若 handler 什么都不做，那个事务只完成了断言就提交：范围快照与**真正的写入**
 * 分属两个事务 ⇒「快照与写入同事务」（ADR-014 / H-ACL-002）被打破，TOCTOU 窗口
 * 重新敞开，而代码看起来仍然"有守卫"。
 *
 * 2026-10-13（架构评审 R2 候选 R11）实测两处中招：
 * `/api/users/[id]/reset-password`（随后的读数与写入各在事务外）与
 * `/api/users/[id]/force-logout`（RT 撤销用事务外的 `db`）。两者都**零测试覆盖**。
 *
 * ## 为什么用静态检查
 *
 * 这是"写对了但没生效"的缺陷，行为测试在正常路径下**看不出差别**（404/403/200 都照常）。
 * 与 `authz-surface.test.ts`、`module-mock-guard.test.ts` 同类：钉住一个**形状**。
 * 需要「加载目标行再动手」时应当用 `withScopedRow`（load → 404 → 断言 → handler 同事务）。
 *
 * @req H-ACL-002
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { REPO_ROOT, assertScannedNonEmpty, stripComments, tsFiles } from '../helpers/repo-scan';
import { join } from 'node:path';

const SRC_DIR = join(REPO_ROOT, 'apps/portal/src');

/**
 * `withScopedWrite(...)` 之后不远处出现**空 handler**：
 * `async () => undefined` 或 `async () => {}`。
 *
 * 上限 2000 字符足以跨过 options 对象字面量，同时不会误伤别的调用点。
 */
const NOOP_HANDLER = /withScopedWrite\([\s\S]{0,2000}?async\s*\(\s*\)\s*=>\s*(?:undefined|\{\s*\})/;



describe('withScopedWrite 不得被当作纯守卫使用', () => {
  it('src/ 下没有任何「空 handler」调用点', () => {
    const scanned = tsFiles(SRC_DIR);
    assertScannedNonEmpty(scanned, 'apps/portal/src 下的 .ts 扫描范围（空 handler 检查）', 40);
    const violations = scanned
      .filter((file) => NOOP_HANDLER.test(stripComments(readFileSync(file, 'utf-8'))))
      .map((file) => file.replace(`${REPO_ROOT}/`, ''));

    expect(
      violations,
      `这些文件把 withScopedWrite 的 handler 写成空函数 —— 守卫事务只做断言就提交，` +
        `真正的写入落在另一个事务里（ADR-014 / H-ACL-002）。` +
        `需要"先加载目标行再动手"时请改用 withScopedRow：\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('守卫自身不是空洞的：能抓到缺陷形状，且不误伤合法写法', () => {
    // 正样：历史上两处的形状
    const defect = `
      await withScopedWrite(
        { operatorId: adminUserId, targets: async (tx) => { const row = await tx.query.users.findFirst({}); return row ? [] : []; } },
        async () => undefined,
      );
    `;
    expect(NOOP_HANDLER.test(defect)).toBe(true);

    const defectEmptyBody = `withScopedWrite({ operatorId }, async () => {})`;
    expect(NOOP_HANDLER.test(defectEmptyBody)).toBe(true);

    // 反样 1：真正在事务里干活的 handler
    const legit = `
      await withScopedWrite({ operatorId, targets: [] }, async (tx) => {
        await tx.insert(schema.departments).values(row);
      });
    `;
    expect(NOOP_HANDLER.test(legit)).toBe(false);

    // 反样 2：withScopedRow 不受本守卫约束（它的 handler 必然拿到 row）
    const scopedRow = `
      await withScopedRow({ operatorId, load, deptOf, message, notFound }, async () => undefined);
    `;
    expect(NOOP_HANDLER.test(scopedRow)).toBe(false);

    // 反样 3：**注释里**描述这个形状不算缺陷（否则修复记录本身会让守卫变红）
    const commentOnly = `
      // 此前写成 withScopedWrite({...}, async () => undefined) —— 事务里什么都没做
      await withScopedRow({ operatorId, load, deptOf, message, notFound }, async (tx, row) => row);
    `;
    expect(NOOP_HANDLER.test(commentOnly)).toBe(true); // 未去注释时确实会命中
    expect(NOOP_HANDLER.test(stripComments(commentOnly))).toBe(false); // 去注释后不命中
  });
});
