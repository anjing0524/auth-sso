/**
 * 数据范围写路径门面测试（真实 DB）
 *
 * 锁住 `withScopedWrite` 的核心不变量：**操作者范围快照与业务写入必须源自
 * 同一事务**。违反它的后果是 TOCTOU——操作者在快照获取之后、写入提交之前
 * 被降权，越权写入仍然成立（H-ACL-002 / ADR-014）。
 *
 * 关键点：`resolveScope` 内部走原生 SQL（`executor.query`），因此这里的可见性
 * 语义是 PostgreSQL 真实行为，不是 mock 出来的。下文的"降权并提交 → 在事务内
 * 取快照"序列等价于并发交错中"降权先提交、守卫后执行"，因为双方不持有对方所需
 * 的锁（`SELECT` 不加锁）。
 *
 * @req H-ACL-002, H-DSCOPE-001
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import * as schema from '@/db/schema';

const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));

// ── 被测模块 ────────────────────────────────────────
import { withScopedWrite, resolveScope, isWithinScope, assertWithinScope } from '@/lib/authz';
import { ForbiddenError } from '@/domain/shared/errors';

const ROOT_DEPT_ID = '00000000-0000-4000-8000-000000000001';
const FE_DEPT_ID = '00000000-0000-4000-8000-000000000003';
const MKT_DEPT_ID = '00000000-0000-4000-8000-000000000005';
const OPERATOR_ID = '00000000-0000-4000-8000-000000000101';
const TARGET_ID = '00000000-0000-4000-8000-000000000201';
const OPERATOR_ROLE_ID = '00000000-0000-4000-8000-000000000501';

/** 根 + 两个平级子部门（FE / MKT） */
function departments() {
  const now = new Date();
  return [
    { id: ROOT_DEPT_ID, parentId: null, name: '总公司', code: 'ROOT',
      ancestors: null, sort: 0, status: 'ACTIVE' as const, createdAt: now, updatedAt: now },
    { id: FE_DEPT_ID, parentId: ROOT_DEPT_ID, name: '前端组', code: 'FE',
      ancestors: ROOT_DEPT_ID, sort: 0, status: 'ACTIVE' as const, createdAt: now, updatedAt: now },
    { id: MKT_DEPT_ID, parentId: ROOT_DEPT_ID, name: '市场部', code: 'MKT',
      ancestors: ROOT_DEPT_ID, sort: 1, status: 'ACTIVE' as const, createdAt: now, updatedAt: now },
  ];
}

/** 操作者在 FE 有角色；目标用户在 MKT（跨部门） */
async function seedOperatorAndTarget() {
  const now = new Date();
  await td.db.insert(schema.roles).values({
    id: OPERATOR_ROLE_ID, name: '前端管理员', code: 'FE_ADMIN',
    deptId: FE_DEPT_ID, status: 'ACTIVE', createdAt: now, updatedAt: now,
  });
  await td.db.insert(schema.users).values([
    { id: OPERATOR_ID, username: 'operator', name: '操作者', deptId: FE_DEPT_ID },
    { id: TARGET_ID, username: 'target', name: '目标用户', deptId: MKT_DEPT_ID },
  ]);
  await td.db.insert(schema.userRoles).values({ userId: OPERATOR_ID, roleId: OPERATOR_ROLE_ID });
}

/** 撤销操作者的角色（独立事务提交）= 降权 */
async function demoteOperator() {
  await td.db.delete(schema.userRoles).where(eq(schema.userRoles.userId, OPERATOR_ID));
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, { departments: departments() });
  await seedOperatorAndTarget();
});

describe('resolveScope — 快照按 executor 的连接归属求值', () => {
  it('降权并提交后，新事务内的快照看到空范围（fail-closed 的前提）', async () => {
    const before = await resolveScope(td.db, OPERATOR_ID);
    expect(before.deptIds).toContain(FE_DEPT_ID);

    await demoteOperator();

    const after = await resolveScope(td.db, OPERATOR_ID);
    expect(after.deptIds).toEqual([]);
  });
});

describe('isWithinScope / assertWithinScope — 纯判定', () => {
  it('空范围与无部门目标一律拒绝', () => {
    expect(isWithinScope({ deptIds: [] }, ROOT_DEPT_ID)).toBe(false);
    expect(isWithinScope({ deptIds: [FE_DEPT_ID] }, null)).toBe(false);
    expect(isWithinScope({ deptIds: [FE_DEPT_ID] }, undefined)).toBe(false);
  });

  it('范围内为真、范围外为假', () => {
    expect(isWithinScope({ deptIds: [FE_DEPT_ID] }, FE_DEPT_ID)).toBe(true);
    expect(isWithinScope({ deptIds: [FE_DEPT_ID] }, MKT_DEPT_ID)).toBe(false);
  });

  it('多目标时任一越界即抛，且抛出的是该目标自己的消息', () => {
    expect(() => assertWithinScope({ deptIds: [FE_DEPT_ID] }, [
      { deptId: FE_DEPT_ID, message: '无权操作该用户' },
      { deptId: MKT_DEPT_ID, message: '无权将用户迁移至该部门' },
    ])).toThrow('无权将用户迁移至该部门');
  });
});

describe('withScopedWrite — 快照与写入同事务', () => {
  it('范围内目标 → 执行 handler 并返回其结果', async () => {
    const result = await withScopedWrite(
      { operatorId: OPERATOR_ID, targets: [{ deptId: FE_DEPT_ID, message: '无权操作该用户' }] },
      async () => 'written',
    );
    expect(result).toBe('written');
  });

  it('范围外目标 → 抛 ForbiddenError，且事务回滚不留写入', async () => {
    await expect(
      withScopedWrite(
        { operatorId: OPERATOR_ID, targets: [{ deptId: MKT_DEPT_ID, message: '无权操作该用户' }] },
        async (tx) => {
          await tx.update(schema.users).set({ name: '越权写入' }).where(eq(schema.users.id, TARGET_ID));
        },
      ),
    ).rejects.toThrow(ForbiddenError);

    const target = await td.db.query.users.findFirst({
      where: eq(schema.users.id, TARGET_ID), columns: { name: true },
    });
    expect(target?.name).toBe('目标用户');
  });

  it('targets 为函数 → 目标在事务内加载，范围判断用的是最新部门归属', async () => {
    // 把目标从 MKT 迁到 FE（操作者范围内），函数式 targets 应据此放行
    await td.db.update(schema.users).set({ deptId: FE_DEPT_ID }).where(eq(schema.users.id, TARGET_ID));

    const observed = await withScopedWrite(
      {
        operatorId: OPERATOR_ID,
        targets: async (tx) => {
          const row = await tx.query.users.findFirst({
            where: eq(schema.users.id, TARGET_ID), columns: { deptId: true },
          });
          return [{ deptId: row?.deptId, message: '无权操作该用户' }];
        },
      },
      async (tx) => {
        await tx.update(schema.users).set({ name: '已更新' }).where(eq(schema.users.id, TARGET_ID));
        return 'ok';
      },
    );
    expect(observed).toBe('ok');

    const target = await td.db.query.users.findFirst({
      where: eq(schema.users.id, TARGET_ID), columns: { name: true },
    });
    expect(target?.name).toBe('已更新');
  });
});

describe('TOCTOU 对照：旧形状 vs 门面形状', () => {
  it('旧形状（事务外快照 + 事务内复用）在降权提交后仍然放行 —— 缺陷可复现', async () => {
    // 旧形状：快照在事务外获取
    const staleSnapshot = await resolveScope(td.db, OPERATOR_ID);
    expect(staleSnapshot.deptIds).toContain(FE_DEPT_ID);

    // 操作者被降权并提交
    await demoteOperator();

    // 事务内复用陈旧快照 → 判定基于已失效的范围 → 放行（这就是缺陷本身）
    let wrote = false;
    await td.db.transaction(async (tx) => {
      if (isWithinScope(staleSnapshot, FE_DEPT_ID)) {
        await tx.update(schema.users).set({ name: '被越权改写' }).where(eq(schema.users.id, TARGET_ID));
        wrote = true;
      }
    });
    expect(wrote).toBe(true);

    const target = await td.db.query.users.findFirst({
      where: eq(schema.users.id, TARGET_ID), columns: { name: true },
    });
    expect(target?.name).toBe('被越权改写');   // ← 已降权的操作者写入成功
  });

  it('门面形状在同样时序下拒绝写入 —— 缺陷已闭合', async () => {
    // 降权发生在门面取快照之前（等价于并发交错中"降权先提交"）
    await demoteOperator();

    await expect(
      withScopedWrite(
        { operatorId: OPERATOR_ID, targets: [{ deptId: FE_DEPT_ID, message: '无权操作该用户' }] },
        async (tx) => {
          await tx.update(schema.users).set({ name: '不应发生' }).where(eq(schema.users.id, TARGET_ID));
        },
      ),
    ).rejects.toThrow(ForbiddenError);

    const target = await td.db.query.users.findFirst({
      where: eq(schema.users.id, TARGET_ID), columns: { name: true },
    });
    expect(target?.name).toBe('目标用户');   // ← 写入未发生
  });
});
