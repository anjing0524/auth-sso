/**
 * H-17（updateUserAction 状态机旁路）+ H-C-02（解锁入口可达）
 *
 * ## 缺陷形态
 * - `UpdateUserInputSchema.status` 是完整枚举，`applyUserUpdate` 只拦「当前已 DELETED」：
 *   于是 LOCKED→ACTIVE 可绕过解锁流程；`status=DELETED` 只写 status、丢弃 `deletedAt`
 *   ⇒ 部分唯一索引永不释放（软删除后邮箱不可复用）。
 * - `unlockUserAction` 无任何 client component 引用 ⇒ 无 action id、HTTP 不可达；
 *   列表「恢复」按钮对 LOCKED 用户走 toggle，被域层拒绝 ⇒ 锁定用户没有合法解锁路径。
 *
 * @req B-USR-ST, DC-USR-ST, DC-USR-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedAdminUser, seedRootDept, seedSuperAdminRole, seedTestUser, seedUserRoleBinding } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';

const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));
// @allow-module-mock @/lib/auth/verify-jwt auth-bypass: 只提供"谁已登录"这一输入；真实 withAuth（权限/错误映射）与真实领域规则全程参与（依赖它的断言：crud-h17-user-status.test.ts 全部用例）
vi.mock(import('@/lib/auth/verify-jwt'), async (importOriginal): Promise<Partial<typeof verifyJwtModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveIdentity: async () => ({ userId: '00000000-0000-4000-8000-000000000101', expiresAt: null, issuedAt: null }),
  };
});
// @allow-module-mock @/lib/crypto input-fixture: 只覆盖确定性 ID，其余导出走真身（依赖它的断言：确定性 UUID 断言）
vi.mock(import('@/lib/crypto'), async (importOriginal): Promise<Partial<typeof cryptoModule>> => {
  const actual = await importOriginal();
  return { ...actual, generateUUID: () => 'aabbccdd-eeff-4000-8000-000000000001', generateId: () => 'aaaaaaaa' };
});

import { updateUserAction, unlockUserAction, toggleUserStatusAction } from '@/app/(dashboard)/users/actions';
import type * as verifyJwtModule from '@/lib/auth/verify-jwt';
import type * as cryptoModule from '@/lib/crypto';

const ADMIN_ID = '00000000-0000-4000-8000-000000000101';
const TARGET_ID = '00000000-0000-4000-8000-000000000201';
const ROOT_DEPT_ID = '00000000-0000-4000-8000-000000000001';
const ROLE_ID = '00000000-0000-4000-8000-000000000301';

async function rowOf(id: string) {
  const [row] = await td.db.select({
    status: schema.users.status,
    deletedAt: schema.users.deletedAt,
    email: schema.users.email,
  }).from(schema.users).where(eq(schema.users.id, id));
  return row;
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedAdminUser(),
    roles: seedSuperAdminRole({ deptId: ROOT_DEPT_ID }),
    userRoles: seedUserRoleBinding(ADMIN_ID, ROLE_ID),
  });
});

describe('H-17 — updateUserAction 必须遵守状态机', () => {
  it('**LOCKED → ACTIVE 被拒绝**（必须走解锁流程），DB 保持 LOCKED', async () => {
    await seedTestData(td.db, { users: seedTestUser({ status: 'LOCKED' }) });

    const r = await updateUserAction(TARGET_ID, { status: 'ACTIVE' } as never);

    if (r.success) expect.unreachable('LOCKED→ACTIVE 必须被拒绝（DC-USR-ST）');
    expect(r.message).toContain('解锁');
    expect((await rowOf(TARGET_ID))!.status).toBe('LOCKED');
  });

  it('LOCKED 用户改资料（status 未变）仍允许', async () => {
    await seedTestData(td.db, { users: seedTestUser({ status: 'LOCKED' }) });

    const r = await updateUserAction(TARGET_ID, { name: '改个名字' } as never);

    expect(r.success).toBe(true);
    const row = await rowOf(TARGET_ID);
    expect(row!.status).toBe('LOCKED');
  });

  it('**status=DELETED 经 update 也必须写 deleted_at**（此前只写 status）', async () => {
    await seedTestData(td.db, { users: seedTestUser() });

    const r = await updateUserAction(TARGET_ID, { status: 'DELETED' } as never);

    expect(r.success).toBe(true);
    const row = await rowOf(TARGET_ID);
    expect(row!.status).toBe('DELETED');
    // 关键：部分唯一索引（WHERE deleted_at IS NULL）据此释放邮箱
    expect(row!.deletedAt).not.toBeNull();
  });

  it('ACTIVE → LOCKED 属管理员合法操作（允许）', async () => {
    await seedTestData(td.db, { users: seedTestUser({ status: 'ACTIVE' }) });

    const r = await updateUserAction(TARGET_ID, { status: 'LOCKED' } as never);

    expect(r.success).toBe(true);
    expect((await rowOf(TARGET_ID))!.status).toBe('LOCKED');
  });
});

describe('H-C-02 — 解锁动作存在且语义正确', () => {
  it('LOCKED → ACTIVE 解锁成功', async () => {
    await seedTestData(td.db, { users: seedTestUser({ status: 'LOCKED' }) });

    const r = await unlockUserAction(TARGET_ID);

    expect(r.success).toBe(true);
    expect((await rowOf(TARGET_ID))!.status).toBe('ACTIVE');
  });

  it('非 LOCKED 用户解锁 → 领域拒绝（仅 LOCKED 需要解锁）', async () => {
    await seedTestData(td.db, { users: seedTestUser({ status: 'ACTIVE' }) });

    const r = await unlockUserAction(TARGET_ID);

    if (r.success) expect.unreachable('非 LOCKED 不应解锁成功');
    expect(r.message).toContain('仅被锁定的用户需要解锁');
  });

  it('列表 toggle 对 LOCKED 仍被拒绝（逼迫 UI 走 unlock）', async () => {
    await seedTestData(td.db, { users: seedTestUser({ status: 'LOCKED' }) });

    const r = await toggleUserStatusAction(TARGET_ID);

    if (r.success) expect.unreachable('LOCKED 不允许 toggle');
    expect(r.message).toContain('请使用解锁功能');
  });

  it('**UI 已接线解锁入口**（机械扫描：列表/详情必须引用 unlockUserAction）', () => {
    const repoRoot = join(__dirname, '..', '..');
    const table = readFileSync(join(repoRoot, 'src/app/(dashboard)/users/components/UserTable.tsx'), 'utf8');
    const detail = readFileSync(join(repoRoot, 'src/app/(dashboard)/users/[id]/UserDetailForm.tsx'), 'utf8');

    expect(table).toContain('unlockUserAction');
    expect(table).toContain("user.status === 'LOCKED'");
    expect(detail).toContain('unlockUserAction');
    expect(detail).toContain('已锁定');
  });
});
