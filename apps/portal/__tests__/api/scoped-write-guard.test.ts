/**
 * 守卫事务不得空转 —— `withScopedWrite` / `withScopedRow` 的 handler 不得为空
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
 * 同样地，`withScopedRow(..., async () => undefined)` 也是零写入：handler 拿到了 row
 * **不等于**用了它——"加守卫但什么都没写"仍是空转。本守卫对两个原语一并检查。
 *
 * ## 另外：空 targets 等于跳过校验（ADR-028）
 *
 * `withScopedWrite({ targets: [] })` 过去可表达"没有目标"——它看起来有守卫、实际不校验。
 * 现在 `ScopeTargets` 类型要求非空，`assertWithinScope` 对空集合 fail-close；本文件再做
 * 静态兜底，防止 `as`/重构把该形状写回来。全局资源写（根部门、无部门用户）走
 * `withGlobalWrite`，不再借用空 targets。
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
 * `withScopedWrite(...)` / `withScopedRow(...)` 之后不远处出现**空 handler**：
 * `async () => undefined` 或 `async () => {}`。
 *
 * 上限 2000 字符足以跨过 options 对象字面量，同时不会误伤别的调用点。
 */
const NOOP_HANDLER = /withScoped(?:Write|Row)\([\s\S]{0,2000}?async\s*\(\s*\)\s*=>\s*(?:undefined|\{\s*\})/;

/** primary `targets: []`（空目标 = 跳过校验；`extraTargets: () => []` 不匹配，它是合法的附加目标） */
const EMPTY_TARGETS = /\btargets:\s*\[\s*\]/;



describe('withScopedWrite / withScopedRow 不得被当作纯守卫使用', () => {
  it('src/ 下没有任何「空 handler」调用点', () => {
    const scanned = tsFiles(SRC_DIR);
    assertScannedNonEmpty(scanned, 'apps/portal/src 下的 .ts 扫描范围（空 handler 检查）', 40);
    const violations = scanned
      .filter((file) => NOOP_HANDLER.test(stripComments(readFileSync(file, 'utf-8'))))
      .map((file) => file.replace(`${REPO_ROOT}/`, ''));

    expect(
      violations,
      `这些文件把 withScopedWrite / withScopedRow 的 handler 写成空函数 —— ` +
        `守卫事务只做断言就提交，真正的写入落在另一个事务里（ADR-014 / H-ACL-002）。` +
        `需要"先加载目标行再动手"时用 withScopedRow，并让 handler 真正使用 tx/row：\n${violations.join('\n')}`,
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

    // 反样 1：真正在事务里干活的 handler（targets 非空，符合 ADR-028）
    const legit = `
      await withScopedWrite({ operatorId, targets: [{ deptId: 'x', message: 'y' }] }, async (tx) => {
        await tx.insert(schema.departments).values(row);
      });
    `;
    expect(NOOP_HANDLER.test(legit)).toBe(false);

    // 正样 3：withScopedRow 拿到 row 但 handler 为空 —— 仍是零写入，必须报（ADR-028）
    const scopedRowNoop = `
      await withScopedRow({ operatorId, load, deptOf, message, notFound }, async () => undefined);
    `;
    expect(NOOP_HANDLER.test(scopedRowNoop)).toBe(true);

    // 反样 2：withScopedRow 真正使用 tx / row 写入
    const scopedRowLegit = `
      await withScopedRow({ operatorId, load, deptOf, message, notFound }, async (tx, row) => {
        await tx.update(schema.users).set({ name: 'x' }).where(eq(schema.users.id, row.id));
      });
    `;
    expect(NOOP_HANDLER.test(scopedRowLegit)).toBe(false);

    // 反样 3：**注释里**描述这个形状不算缺陷（否则修复记录本身会让守卫变红）
    const commentOnly = `
      // 此前写成 withScopedWrite({...}, async () => undefined) —— 事务里什么都没做
      await withScopedRow({ operatorId, load, deptOf, message, notFound }, async (tx, row) => row);
    `;
    expect(NOOP_HANDLER.test(commentOnly)).toBe(true); // 未去注释时确实会命中
    expect(NOOP_HANDLER.test(stripComments(commentOnly))).toBe(false); // 去注释后不命中
  });
});

describe('withScopedWrite 不得用空 targets 跳过校验（ADR-028）', () => {
  it('src/ 下没有 primary `targets: []` 的调用点', () => {
    const scanned = tsFiles(SRC_DIR);
    assertScannedNonEmpty(scanned, 'apps/portal/src 下的 .ts 扫描范围（空 targets 检查）', 40);
    const violations = scanned
      .filter((file) => EMPTY_TARGETS.test(stripComments(readFileSync(file, 'utf-8'))))
      .map((file) => file.replace(`${REPO_ROOT}/`, ''));

    expect(
      violations,
      '这些文件用空 targets 调用 withScopedWrite —— 空目标等于跳过校验。' +
        '有具体目标时传非空数组；需要先加载目标行用 withScopedRow；全局资源写用 withGlobalWrite：\n' +
        violations.join('\n'),
    ).toEqual([]);
  });

  it('空 targets 夹具自测：能抓到违例、不误伤 extraTargets 的空数组', () => {
    expect(EMPTY_TARGETS.test(`withScopedWrite({ operatorId, targets: [] }, async (tx) => {})`)).toBe(true);
    expect(EMPTY_TARGETS.test(`withScopedWrite({ operatorId, extraTargets: () => [] }, async (tx) => {})`)).toBe(false);
    expect(
      EMPTY_TARGETS.test(`withScopedWrite({ operatorId, targets: [{ deptId: 'x', message: 'y' }] }, async (tx) => {})`),
    ).toBe(false);
  });

  it('权限授予写路径使用 withScopedRow 单次加载（不再有 scopedTargets 二次加载）', () => {
    const files = [
      'apps/portal/src/lib/user-role-assignment.ts',
      'apps/portal/src/lib/role-permission-assignment.ts',
    ];
    const violations = files.filter((rel) => {
      const code = stripComments(readFileSync(join(REPO_ROOT, rel), 'utf-8'));
      return /scopedTargets/.test(code) || /withScopedWrite/.test(code) || !/withScopedRow/.test(code);
    });

    expect(
      violations,
      '权限授予写路径必须经 withScopedRow（load → 404 → 断言 → handler 用同一份 row）；' +
        '不得再用 scopedTargets + withScopedWrite + handler 二次加载（ADR-028）：\n' +
        violations.join('\n'),
    ).toEqual([]);
  });
});
