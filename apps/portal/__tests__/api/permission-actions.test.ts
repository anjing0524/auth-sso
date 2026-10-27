/**
 * Permission Server Actions 集成测试（真实 DB）
 *
 * @req D-PRM-C, D-PRM-U, D-PRM-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedAdminUser, seedRootDept, seedSuperAdminRole, seedTestPermission, seedUserRoleBinding } from '../helpers/seed-fixtures';
import { COMMON_ERRORS } from '@auth-sso/contracts';
import * as schema from '@/db/schema';

// ── 测试数据库 ──────────────────────────────────────
const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));
// 2026-10-14（#84，沿用 #71 已验证的修法）：**只 mock 身份解析，让 `withAuth` 跑真身**
// （整体替换会连带删掉错误映射，使断言钉住与生产相反的契约）。
// @allow-module-mock @/lib/auth/verify-jwt auth-bypass: 只提供"谁已登录"这一输入；本文件依赖它的断言：全部用例的操作者身份。鉴权链路其余部分走真身；合法理由见 ADR-022（reason 点名本文件 permission-actions.test.ts）
vi.mock(import('@/lib/auth/verify-jwt'), async (importOriginal): Promise<Partial<typeof verifyJwtModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveIdentity: async () => ({
      userId: '00000000-0000-4000-8000-000000000101',
      expiresAt: null,
      issuedAt: null,
    }),
  };
});
// @allow-module-mock @/lib/crypto input-fixture: 只覆盖「确定性 ID」这类输入，其余导出（含 hashToken）走真身
vi.mock(import('@/lib/crypto'), async (importOriginal): Promise<Partial<typeof cryptoModule>> => {
  const actual = await importOriginal();
  // 只覆盖「确定性 ID」，其余导出（含 hashToken 的真实 sha256）走真身：
  // 整体替换会让未列出的导出变成 undefined，而注解却声称它们走真实实现
  return {
    ...actual,
    generateUUID: () => 'aabbccdd-eeff-4000-8000-000000000001',
  };
});
// 其余导出**必须保留真身**：`withAuth` 跑真身后 `checkPermission` 需要 `getUserPermissionContext`
// @allow-module-mock @/lib/permissions input-fixture: 只提供权限上下文输入；真实 PG 驱动的分级由 permission-enforcement / rt-permission-failure 覆盖
vi.mock(import('@/lib/permissions'), async (importOriginal): Promise<Partial<typeof permissionsModule>> => {
  const actual = await importOriginal();
  return { ...actual, refreshUsersPermissionCache: vi.fn(async () => ({ succeeded: 0, failed: 0 })) };
});
// @allow-module-mock @/lib/session/revoke input-fixture: 只提供"撤销已完成/计数为 N"这类输入；真实 Redis 撤销由 force-logout-revocation / oauth-revoke 覆盖
vi.mock(import('@/lib/session/revoke'), async (importOriginal): Promise<Partial<typeof sessionRevokeModule>> => {
  const actual = await importOriginal();
  return { ...actual, revokeUsersAccessByUserId: vi.fn(async () => ({ succeeded: 0, failed: 0 })) };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { db } from '@/infrastructure/db';
import { createPermissionAction, updatePermissionAction, deletePermissionAction } from '@/app/(dashboard)/permissions/actions';
import type * as verifyJwtModule from '@/lib/auth/verify-jwt';
import type * as cryptoModule from '@/lib/crypto';
import type * as permissionsModule from '@/lib/permissions';
import type * as sessionRevokeModule from '@/lib/session/revoke';


const PERM_ID = '00000000-0000-4000-8000-000000000401';

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  await td.cleanup();
  // 真身鉴权链路要求操作者在库中真实拥有一个根部门角色（SUPER_ADMIN 绕过权限码，ADR-001）
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedAdminUser(),
    roles: seedSuperAdminRole({ deptId: '00000000-0000-4000-8000-000000000001' }),
    userRoles: seedUserRoleBinding('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000301'),
  });
});

describe('Permission Server Actions', () => {
  describe('createPermissionAction', () => {
    it('有效输入 → DB insert 包含 code/name/type', async () => {
      const r: any = await createPermissionAction({
        code: 'NEW', name: 'New Permission', type: 'API',
      } as any);

      expect(r.success).toBe(true);
      expect(r.data).toBeDefined();
      expect(r.data.id).toBe('aabbccdd-eeff-4000-8000-000000000001');

      const perms = await db.select().from(schema.permissions);
      const created = perms.find(p => p.code === 'NEW');
      expect(created).toBeDefined();
      expect(created!.name).toBe('New Permission');
      expect(created!.type).toBe('API');
    });

    it('缺 code → 返回 success: false', async () => {
      const r: any = await createPermissionAction({
        code: '', name: '', type: '',
      } as any);

      expect(r.success).toBe(false);
      expect(r.error).toBeDefined();
    });
  });

  describe('updatePermissionAction', () => {
    it('存在 → 返回 success: true 且正确更新字段', async () => {
      await seedTestData(td.db, { permissions: seedTestPermission() });

      const r: any = await updatePermissionAction(PERM_ID, { name: 'Updated Name' } as any);

      expect(r.success).toBe(true);
      expect(r.data.id).toBe(PERM_ID);

      const perms = await db.select().from(schema.permissions);
      const updated = perms.find(p => p.id === PERM_ID);
      expect(updated).toBeDefined();
      expect(updated!.name).toBe('Updated Name');
    });

    it('不存在 → 失败信封 NOT_FOUND（生产契约）', async () => {
      const r = await updatePermissionAction('00000000-0000-4000-8000-000000000999', { name: 'X' } as any);

      if (r.success) expect.unreachable('应当被拒绝（生产契约：失败信封）');
      expect(r.error).toBe(COMMON_ERRORS.NOT_FOUND);
    });

    it('内置权限不可修改类型（编码被服务端引用）', async () => {
      await seedTestData(td.db, { permissions: seedTestPermission({ code: 'portal:user:list' }) });

      const r: any = await updatePermissionAction(PERM_ID, { type: 'PAGE', path: '/x' } as any);

      if (r.success) expect.unreachable('内置权限改类型应被拒绝');
      expect(r.message).toContain('内置权限不可修改类型');
    });
  });

  describe('deletePermissionAction', () => {
    it('存在 → 返回 success: true 且 data.id 正确', async () => {
      await seedTestData(td.db, { permissions: seedTestPermission() });

      const r: any = await deletePermissionAction(PERM_ID);

      expect(r.success).toBe(true);
      expect(r.data.id).toBe(PERM_ID);

      const perms = await db.select().from(schema.permissions);
      expect(perms.find(p => p.id === PERM_ID)).toBeUndefined();
    });

    it('不存在 → 失败信封 NOT_FOUND（生产契约）', async () => {
      const r = await deletePermissionAction('00000000-0000-4000-8000-000000000999');

      if (r.success) expect.unreachable('应当被拒绝（生产契约：失败信封）');
      expect(r.error).toBe(COMMON_ERRORS.NOT_FOUND);
    });
  });
});
