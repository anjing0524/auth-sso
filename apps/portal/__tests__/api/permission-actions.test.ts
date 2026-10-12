/**
 * Permission Server Actions 集成测试（真实 DB）
 *
 * @req D-PRM-C, D-PRM-U, D-PRM-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { EntityNotFoundError } from '@/domain/shared/errors';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedRootDept, seedTestPermission } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';

// ── 测试数据库 ──────────────────────────────────────
const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));
// @allow-module-mock @/lib/auth auth-bypass: 本文件被测语义不依赖登录/授权链路，mock 仅用于构造"已登录/已授权"的请求上下文（依赖它的断言：permission-actions.test.ts 全部用例）
vi.mock(import('@/lib/auth'), (): Partial<typeof authModule> => ({
  resolveIdentity: vi.fn(async () => ({ userId: '00000000-0000-4000-8000-000000000101', expiresAt: null, issuedAt: null })),
  logServerDataRead: vi.fn(async () => {}),
  withAuth: (_o: any, h: Function) => async (...a: any[]) =>
    h({ userId: '00000000-0000-4000-8000-000000000101' }, ...a),
}));
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
// @allow-module-mock @/lib/permissions input-fixture: 只提供权限上下文输入；真实 PG 驱动的分级由 permission-enforcement / rt-permission-failure 覆盖
vi.mock(import('@/lib/permissions'), (): Partial<typeof permissionsModule> => ({ refreshUsersPermissionCache: vi.fn(async () => ({ succeeded: 0, failed: 0 })) }));
// @allow-module-mock @/lib/session/revoke input-fixture: 只提供"撤销已完成/计数为 N"这类输入；真实 Redis 撤销由 force-logout-revocation / oauth-revoke 覆盖
vi.mock(import('@/lib/session/revoke'), (): Partial<typeof sessionRevokeModule> => ({ revokeUsersAccessByUserId: vi.fn(async () => ({ succeeded: 0, failed: 0 })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { db } from '@/infrastructure/db';
import { createPermissionAction, updatePermissionAction, deletePermissionAction } from '@/app/(dashboard)/permissions/actions';
import type * as authModule from '@/lib/auth';
import type * as cryptoModule from '@/lib/crypto';
import type * as permissionsModule from '@/lib/permissions';
import type * as sessionRevokeModule from '@/lib/session/revoke';


const PERM_ID = '00000000-0000-4000-8000-000000000401';

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, { departments: seedRootDept() });
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

    it('不存在 → 抛出 EntityNotFoundError', async () => {
      await expect(
        updatePermissionAction('00000000-0000-4000-8000-000000000999', { name: 'X' } as any),
      ).rejects.toThrow(EntityNotFoundError);
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

    it('不存在 → 抛出 EntityNotFoundError', async () => {
      await expect(
        deletePermissionAction('00000000-0000-4000-8000-000000000999'),
      ).rejects.toThrow(EntityNotFoundError);
    });
  });
});
