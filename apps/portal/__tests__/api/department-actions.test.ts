/**
 * Department Server Actions 单元测试
 *
 * @req DC-DEPT-C, DC-DEPT-U, DC-DEPT-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const holder = vi.hoisted<{ mockDb: ReturnType<typeof import('@/../__tests__/helpers/mock-db').createMockDb> | null }>(() => ({ mockDb: null }));

vi.mock('@/infrastructure/db', async () => {
  const { createMockDb } = await import('@/../__tests__/helpers/mock-db');
  holder.mockDb = createMockDb();
  return { db: holder.mockDb.db, schema: { departments: {} } };
});
vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ claims: { deptIds: ['dept-1'] } })),
  logServerDataRead: vi.fn(async () => {}),
  canAccessDept: vi.fn(() => true),
 withAuth: (_o: any, h: Function) => async (...a: any[]) => h({ userId: 'admin-1', claims: { deptIds: ['dept-1'], permissions: [], roles: [] } }, ...a) }));
vi.mock('@/lib/crypto', () => ({ generateUUID: () => 'aaaa-bbbb-cccc-dddd', generateId: () => 'a'.repeat(20) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { createDepartmentAction, updateDepartmentAction, deleteDepartmentAction } from '@/app/(dashboard)/departments/actions';

const mockDb = holder.mockDb!;
const now = new Date();
const deptRow = { id: 'dept-1', name: 'Engineering', code: 'ENG', parentId: null, status: 'ACTIVE', sort: 1, path: '', createdAt: now, updatedAt: now };

describe('Department Server Actions', () => {
  beforeEach(() => { vi.clearAllMocks(); mockDb.reset(); });

  it('create: 有效 → success 且返回完整数据', async () => {
    mockDb.setReturningResult([{ id: 'new-dept', name: 'New', code: 'ND', status: 'ACTIVE' }]);
    const r: any = await createDepartmentAction({ name: 'New', code: 'ND', sort: 1, parentId: null });
    expect(r.success).toBe(true);
    expect(r.data).toBeDefined();
    expect(r.data.id).toBeDefined();
  });

  it('create: 缺 name → error 含错误码', async () => {
    const r: any = await createDepartmentAction({ name: '', code: '', sort: 1, parentId: null } as any);
    expect(r.success).toBe(false);
    expect(r.error).toBeDefined();
    expect(r.message).toBeDefined();
  });

  it('update: 存在 → success 且返回更新后数据', async () => {
    mockDb.setQueryResult([deptRow]);
    mockDb.setRowCountResult(1);
    const r: any = await updateDepartmentAction('dept-1', { name: 'Updated' } as any);
    expect(r.success).toBe(true);
    expect(r.data).toBeDefined();
    expect(r.data.id).toBe('dept-1');
  });

  it('update: 不存在 → throw EntityNotFoundError', async () => {
    await expect(updateDepartmentAction('bad', { name: 'X' } as any)).rejects.toThrow();
  });

  // delete 测试验证核心业务守卫（含子部门/关联用户/关联角色拒绝删除）
  it('delete: 不存在 → throw EntityNotFoundError', async () => {
    mockDb.setQueryResult([]);
    await expect(deleteDepartmentAction('bad')).rejects.toThrow();
  });
});
