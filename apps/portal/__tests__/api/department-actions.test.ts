/**
 * Department Server Actions 集成测试（真实 DB）
 *
 * @req DC-DEPT-C, DC-DEPT-U, DC-DEPT-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { EntityNotFoundError, BusinessRuleViolationError } from '@/domain/shared/errors';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedRootDept, seedSubDept, seedTestUser } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';

// ── 测试数据库 ──────────────────────────────────────
const td = createTestDbHandle();

const ROOT_DEPT_ID = '00000000-0000-4000-8000-000000000001';
const TECH_DEPT_ID = '00000000-0000-4000-8000-000000000002';
const CHILD_DEPT_ID = '00000000-0000-4000-8000-000000000003';
const WITH_USERS_DEPT_ID = '00000000-0000-4000-8000-000000000004';
const CREATED_DEPT_ID = 'aabbccdd-eeff-4000-8000-000000000001';

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));
vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ userId: '00000000-0000-4000-8000-000000000101', claims: { sub: '', iss: '', aud: 'auth-sso', jti: '' } })),
  logServerDataRead: vi.fn(async () => {}),
  getUserRoleDeptIds: vi.fn().mockResolvedValue([]),
  canAccessDept: vi.fn(() => true),
  withAuth: (_o: any, h: Function) => async (...a: any[]) =>
    h({ userId: '00000000-0000-4000-8000-000000000101' }, ...a),
}));
vi.mock('@/lib/crypto', () => ({
  generateUUID: () => CREATED_DEPT_ID,
  generateId: (_len?: number) => 'aaaaaaaa',
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { db } from '@/infrastructure/db';
import { createDepartmentAction, updateDepartmentAction, deleteDepartmentAction } from '@/app/(dashboard)/departments/actions';

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, { departments: seedRootDept() });
});

describe('Department Server Actions', () => {
  describe('createDepartmentAction', () => {
    it('有效输入 → 返回 success: true 并写入部门', async () => {
      const r: any = await createDepartmentAction({ name: 'New Dept', code: 'ND', sort: 1, parentId: null });

      expect(r.success).toBe(true);
      expect(r.data.id).toBeDefined();
      expect(r.message).toBe('部门创建成功');

      const rows = await db.select().from(schema.departments);
      const created = rows.find(d => d.name === 'New Dept');
      expect(created).toBeDefined();
      expect(created!.code).toBe('ND');
      expect(created!.sort).toBe(1);
      expect(created!.parentId).toBeNull();
      expect(created!.ancestors).toBeNull();
    });

    it('有 parentId → ancestors 正确计算', async () => {
      const r: any = await createDepartmentAction({ name: 'Child', code: 'C', sort: 0, parentId: ROOT_DEPT_ID });

      expect(r.success).toBe(true);

      const rows = await db.select().from(schema.departments);
      const child = rows.find(d => d.name === 'Child');
      expect(child).toBeDefined();
      expect(child!.parentId).toBe(ROOT_DEPT_ID);
      expect(child!.ancestors).toBe(ROOT_DEPT_ID);
    });

    it('缺 name → 返回 success: false 并包含错误码', async () => {
      const r: any = await createDepartmentAction({ name: '', code: '', sort: 1, parentId: null } as any);

      expect(r.success).toBe(false);
      expect(r.error).toBeDefined();
      expect(r.message).toBeDefined();
    });
  });

  describe('updateDepartmentAction', () => {
    it('存在部门 → 返回 success: true 且 DB 更新', async () => {
      await seedTestData(td.db, { departments: seedSubDept() });

      const r: any = await updateDepartmentAction(TECH_DEPT_ID, { name: 'Updated Tech' } as any);

      expect(r.success).toBe(true);
      expect(r.message).toBe('部门更新成功');
      expect(r.data.id).toBe(TECH_DEPT_ID);

      const rows = await db.select().from(schema.departments);
      const updated = rows.find(d => d.id === TECH_DEPT_ID);
      expect(updated).toBeDefined();
      expect(updated!.name).toBe('Updated Tech');
    });

    it('不存在部门 → 抛出 EntityNotFoundError', async () => {
      await expect(
        updateDepartmentAction('00000000-0000-4000-8000-000000000999', { name: 'X' } as any)
      ).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe('deleteDepartmentAction', () => {
    it('无依赖叶子部门 → 返回 success: true 且从 DB 删除', async () => {
      await seedTestData(td.db, { departments: seedSubDept() });

      const r: any = await deleteDepartmentAction(TECH_DEPT_ID);

      expect(r.success).toBe(true);
      expect(r.message).toBe('部门已删除');
      expect(r.data.id).toBe(TECH_DEPT_ID);

      const rows = await db.select().from(schema.departments);
      expect(rows.find(d => d.id === TECH_DEPT_ID)).toBeUndefined();
    });

    it('不存在部门 → 抛出 EntityNotFoundError', async () => {
      await expect(
        deleteDepartmentAction('00000000-0000-4000-8000-000000000999')
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('有子部门 → 抛出 BusinessRuleViolationError', async () => {
      await seedTestData(td.db, {
        departments: [
          ...(seedSubDept()!),
          {
            id: CHILD_DEPT_ID,
            parentId: TECH_DEPT_ID,
            name: '前端组',
            code: 'FE',
            ancestors: `${ROOT_DEPT_ID}/${TECH_DEPT_ID}`,
            sort: 0,
            status: 'ACTIVE',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });

      await expect(
        deleteDepartmentAction(TECH_DEPT_ID)
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('有用户关联 → 抛出 BusinessRuleViolationError', async () => {
      await seedTestData(td.db, {
        departments: [{
          id: WITH_USERS_DEPT_ID,
          parentId: ROOT_DEPT_ID,
          name: '有人部门',
          code: 'WU',
          ancestors: ROOT_DEPT_ID,
          sort: 0,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        }],
        users: seedTestUser({ deptId: WITH_USERS_DEPT_ID, id: '00000000-0000-4000-8000-000000000201' }),
      });

      await expect(
        deleteDepartmentAction(WITH_USERS_DEPT_ID)
      ).rejects.toThrow(BusinessRuleViolationError);
    });
  });
});
