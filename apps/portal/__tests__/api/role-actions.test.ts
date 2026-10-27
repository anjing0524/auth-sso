/**
 * Role Server Actions 集成测试（真实 DB）
 *
 * 使用 TRUNCATE CASCADE 模式实现测试隔离，验证所有 CRUD 操作端到端正确性。
 *
 * @req C-ROL-C, C-ROL-U, C-ROL-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { COMMON_ERRORS } from '@auth-sso/contracts';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedAdminUser, seedRootDept, seedSuperAdminRole, seedUserRoleBinding } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';

// ── 测试数据库 ──────────────────────────────────────
const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));
// 2026-10-14（#84，沿用 #71 已验证的修法）：**只 mock 身份解析，让 `withAuth` 跑真身**。
// 整体替换 `@/lib/auth` 会连带删掉**错误映射**（生产 `withAuth` 从不放领域错误逃逸，
// 而是返回 `{ success:false, error, message }`），使断言钉住与生产相反的契约。
// 依据：`check-permission.ts` 从 `./verify-jwt` 直接导入 `resolveIdentity`，
// 且 `checkPermission` 有 SUPER_ADMIN 绕过（ADR-001）——本文件 beforeEach 已播种该角色。
// @allow-module-mock @/lib/auth/verify-jwt auth-bypass: 只提供"谁已登录"这一输入；本文件依赖它的断言：全部用例的操作者身份。鉴权链路其余部分走真身；合法理由见 ADR-022（reason 点名本文件 role-actions.test.ts）
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
    generateId: (_len?: number) => 'aaaaaaaa',
  };
});
const { effectsMocks } = vi.hoisted(() => ({
  effectsMocks: {
    refreshUsers: vi.fn(async () => ({ succeeded: 0, failed: 0 })),
    revokeUsers: vi.fn(async () => ({ succeeded: 0, failed: 0 })),
  },
}));

// （#84：`withAuth` 跑真身后，`checkPermission` 需要本模块的 `getUserPermissionContext`——
//  先前整体替换只给出 `refreshUsersPermissionCache`，会让它变成 undefined ⇒ tsc 不报、运行时 500）
// @allow-module-mock @/lib/permissions input-fixture: 只覆盖批量刷新结果这一输入；其余导出**必须保留真身**
vi.mock(import('@/lib/permissions'), async (importOriginal): Promise<Partial<typeof permissionsModule>> => {
  const actual = await importOriginal();
  return { ...actual, refreshUsersPermissionCache: effectsMocks.refreshUsers };
});
// @allow-module-mock @/lib/session/revoke input-fixture: 只提供批量撤销结果这一输入；真实 Redis 撤销由 force-logout-revocation / oauth-revoke 覆盖
vi.mock(import('@/lib/session/revoke'), async (importOriginal): Promise<Partial<typeof sessionRevokeModule>> => {
  const actual = await importOriginal();
  return { ...actual, revokeUsersAccessByUserId: effectsMocks.revokeUsers };
});
vi.mock('@/infrastructure/redis', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { db } from '@/infrastructure/db';
import { createRoleAction, updateRoleAction, deleteRoleAction, updateRolePermissionsAction } from '@/app/(dashboard)/roles/actions';
import type * as verifyJwtModule from '@/lib/auth/verify-jwt';
import type * as cryptoModule from '@/lib/crypto';
import type * as permissionsModule from '@/lib/permissions';
import type * as sessionRevokeModule from '@/lib/session/revoke';


const DEPT_ID = '00000000-0000-4000-8000-000000000001';
const ROLE_ID_UPDATE = '00000000-0000-4000-8000-000000000401';
const ROLE_ID_DELETE = '00000000-0000-4000-8000-000000000402';
const now = new Date();

function seedTestRole(overrides: Partial<typeof schema.roles.$inferInsert> = {}): Array<typeof schema.roles.$inferInsert> {
  return [{
    id: ROLE_ID_UPDATE,
    name: 'Test Role',
    code: 'TEST_ROLE',
    description: '',
    deptId: DEPT_ID,
    isSystem: false,
    status: 'ACTIVE' as const,
    sort: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }];
}

function seedDeleteRole(): Array<typeof schema.roles.$inferInsert> {
  return [{
    id: ROLE_ID_DELETE,
    name: 'Delete Role',
    code: 'DELETE_ROLE',
    description: '',
    deptId: DEPT_ID,
    isSystem: false,
    status: 'ACTIVE' as const,
    sort: 1,
    createdAt: now,
    updatedAt: now,
  }];
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  await td.cleanup();
  // 数据范围守卫现由真实 resolveScope（lib/authz）解析，不再经过被 mock 的
  // @/lib/auth。操作者须在库中真实拥有一个根部门角色，否则可见范围为空。
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedAdminUser(),
    roles: seedSuperAdminRole({ deptId: '00000000-0000-4000-8000-000000000001' }),
    userRoles: seedUserRoleBinding('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000301'),
  });
});

describe('Role Server Actions', () => {
  describe('createRoleAction', () => {
    it('有效输入 → 返回 success: true 并写入角色', async () => {
      const r: any = await createRoleAction({ name: 'Test', code: 'TEST', sort: 1, deptId: DEPT_ID });
      expect(r.success).toBe(true);
      expect(r.data.id).toBeDefined();
      expect(r.data.id).toBe('aabbccdd-eeff-4000-8000-000000000001');

      const rows = await db.select().from(schema.roles);
      const role = rows.find(r => r.code === 'TEST');
      expect(role).toBeDefined();
      expect(role!.name).toBe('Test');
      expect(role!.deptId).toBe(DEPT_ID);
      expect(role!.status).toBe('ACTIVE');
    });

    it('缺 code → 返回 success: false 且包含 VALIDATION_ERROR', async () => {
      const r: any = await createRoleAction({ name: 'X', code: '', sort: 1, deptId: DEPT_ID } as any);
      expect(r.success).toBe(false);
      expect(r.error).toBe(COMMON_ERRORS.VALIDATION_ERROR);
    });

    it('部门不存在 → 失败信封 NOT_FOUND（生产契约）', async () => {
      const r = await createRoleAction({ name: 'X', code: 'XX', sort: 1, deptId: '00000000-0000-4000-8000-000000000999' });

      if (r.success) expect.unreachable('应当被拒绝（生产契约：失败信封）');
      expect(r.error).toBe(COMMON_ERRORS.NOT_FOUND);
    });

    it('部门已禁用 → 失败信封 VALIDATION_ERROR（生产契约）', async () => {
      await seedTestData(td.db, {
        departments: [{
          id: '00000000-0000-4000-8000-000000000002',
          parentId: null,
          name: 'Disabled Dept',
          code: 'DISABLED',
          ancestors: null,
          sort: 0,
          status: 'DISABLED',
          createdAt: now,
          updatedAt: now,
        }],
      });
      const r = await createRoleAction({ name: 'X', code: 'XX', sort: 1, deptId: '00000000-0000-4000-8000-000000000002' });

      if (r.success) expect.unreachable('停用部门下不得建角色');
      expect(r.error).toBe(COMMON_ERRORS.VALIDATION_ERROR);
    });
  });

  describe('updateRoleAction', () => {
    it('有效输入 → 返回 success: true 且 DB 中 name 已更新', async () => {
      await seedTestData(td.db, { roles: seedTestRole() });
      const r: any = await updateRoleAction(ROLE_ID_UPDATE, { name: 'Updated' } as any);
      expect(r.success).toBe(true);
      expect(r.message).toBe('角色更新成功');

      const rows = await db.select().from(schema.roles);
      const updated = rows.find(r => r.id === ROLE_ID_UPDATE);
      expect(updated!.name).toBe('Updated');
    });

    it('可停用并恢复角色（status）', async () => {
      await seedTestData(td.db, { roles: seedTestRole() });

      const off: any = await updateRoleAction(ROLE_ID_UPDATE, { status: 'DISABLED' } as any);
      expect(off.success).toBe(true);
      let rows = await db.select().from(schema.roles);
      let row = rows.find((r) => r.id === ROLE_ID_UPDATE);
      expect(row?.status).toBe('DISABLED');

      const on: any = await updateRoleAction(ROLE_ID_UPDATE, { status: 'ACTIVE' } as any);
      expect(on.success).toBe(true);
      rows = await db.select().from(schema.roles);
      row = rows.find((r) => r.id === ROLE_ID_UPDATE);
      expect(row?.status).toBe('ACTIVE');
    });

    it('角色不存在 → 失败信封 NOT_FOUND（生产契约）', async () => {
      const r = await updateRoleAction('00000000-0000-4000-8000-000000000999', { name: 'X' } as any);

      if (r.success) expect.unreachable('应当被拒绝（生产契约：失败信封）');
      expect(r.error).toBe(COMMON_ERRORS.NOT_FOUND);
    });
  });

  describe('deleteRoleAction', () => {
    it('非系统角色 → 返回 success: true 且角色已删除', async () => {
      await seedTestData(td.db, { roles: seedDeleteRole() });
      const r: any = await deleteRoleAction(ROLE_ID_DELETE);
      expect(r.success).toBe(true);
      expect(r.data.id).toBe(ROLE_ID_DELETE);
      expect(r.message).toBe('角色已删除');

      const rows = await db.select().from(schema.roles);
      const deleted = rows.find(r => r.id === ROLE_ID_DELETE);
      expect(deleted).toBeUndefined();
    });

    it('角色不存在 → 失败信封 NOT_FOUND（生产契约）', async () => {
      const r = await deleteRoleAction('00000000-0000-4000-8000-000000000999');

      if (r.success) expect.unreachable('应当被拒绝（生产契约：失败信封）');
      expect(r.error).toBe(COMMON_ERRORS.NOT_FOUND);
    });

    it('**绑定用户必须同时被撤销与刷新**（配对由 module 保证，不靠调用点记得）', async () => {
      effectsMocks.revokeUsers.mockClear();
      effectsMocks.refreshUsers.mockClear();

      await seedTestData(td.db, { roles: seedDeleteRole() });
      const boundUser = '00000000-0000-4000-8000-000000000101';
      // 给被删角色绑一个真实用户，使"受影响用户集"（按角色真实求）非空
      await td.db.insert(schema.userRoles).values({ userId: boundUser, roleId: ROLE_ID_DELETE, createdAt: now });

      const r: any = await deleteRoleAction(ROLE_ID_DELETE);
      expect(r.success).toBe(true);

      // 漏掉任何一半此前都没有信号（历史上"只刷不撤"与"只撤不刷"都出现过）
      expect(effectsMocks.revokeUsers).toHaveBeenCalledWith([boundUser]);
      expect(effectsMocks.refreshUsers).toHaveBeenCalledWith([boundUser]);
      // 顺序固定：先撤销（安全相关），后刷新（缓存性）
      expect(effectsMocks.revokeUsers.mock.invocationCallOrder[0]!)
        .toBeLessThan(effectsMocks.refreshUsers.mock.invocationCallOrder[0]!);
    });
  });

  describe('updateRolePermissionsAction', () => {
    it('角色不存在 → 失败信封 NOT_FOUND（withScopedRow 单次加载后的 404 语义）', async () => {
      const r = await updateRolePermissionsAction('00000000-0000-4000-8000-000000000999', []);

      if (r.success) expect.unreachable('不存在的角色必须被拒绝');
      expect(r.error).toBe(COMMON_ERRORS.NOT_FOUND);
    });
  });
});
