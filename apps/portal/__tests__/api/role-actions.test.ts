/**
 * Role Server Actions 单元测试
 *
 * @req DC-ROLE-C, DC-ROLE-U, DC-ROLE-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  let _row: any = undefined;
  let _rows: any[] = [];
  const single = (): any => { const c: any = () => {}; c.then = (r: Function) => r(_row); return c; };
  const list = (): any => { const c: any = () => {}; c.then = (r: Function) => r(_rows); return new Proxy(c, { get(_t, p: string) { if (p === 'then' || p === 'catch') return c[p as keyof typeof c]; return () => list(); } }); };
  const insert = () => ({ values: (d: any) => ({ returning: () => Promise.resolve([{ ...d, id: 'mock-id' }]), then: (r: Function) => r(1) }) });
  const update = () => ({ set: () => ({ where: () => ({ then: (r: Function) => r(1) }) }) });
  const del = () => ({ where: () => ({ then: (r: Function) => r(1) }) });
  const queryProxy = new Proxy({} as any, { get() { return { findFirst: () => single() }; } });
  function makeTx() { return new Proxy({} as any, { get(_t, p: string) { if (p === 'select') return () => list(); if (p === 'insert') return insert; if (p === 'update') return update; if (p === 'delete') return del; if (p === 'query') return queryProxy; return undefined; } }); }
  const mockDb = new Proxy({} as any, { get(_t, p: string) { if (p === 'select') return () => list(); if (p === 'insert') return insert; if (p === 'update') return update; if (p === 'delete') return del; if (p === 'transaction') return (h: Function) => h(makeTx()); if (p === 'query') return queryProxy; return undefined; } });
  return { mockDb, setRow(r: any) { _row = r; _rows = r ? [r] : []; }, setRows(r: any[]) { _rows = r; _row = r[0]; }, setDeptRow(r: any) { _row = r; }, reset() { _row = undefined; _rows = []; } };
});

vi.mock('@/infrastructure/db', () => ({ db: mocks.mockDb, schema: { roles: {}, userRoles: {}, rolePermissions: {}, departments: { id: {}, status: {} } } }));
vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ claims: { deptIds: ['dept-1'] } })),
  logServerDataRead: vi.fn(async () => {}),
  canAccessDept: vi.fn(() => true),
 withAuth: (_o: any, h: Function) => async (...a: any[]) => h({ userId: 'admin-1', claims: { deptIds: ['dept-1'], permissions: [], roles: [] } }, ...a) }));
vi.mock('@/lib/crypto', () => ({ generateUUID: () => 'aaaa-bbbb-cccc-dddd', generateId: (_len?: number) => 'a'.repeat(20) }));
vi.mock('@/lib/permissions', () => ({ refreshUsersPermissionCache: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { createRoleAction, updateRoleAction, deleteRoleAction } from '@/app/(dashboard)/roles/actions';

const now = new Date();
const roleRow = { id: 'role-1', code: 'TEST_ROLE', name: 'Test', isSystem: false, status: 'ACTIVE', deptId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789', sort: 1, description: '', createdAt: now, updatedAt: now };

describe('Role Server Actions', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.reset(); });

  it('createRole: 有效输入 → success 且返回完整数据', async () => {
    mocks.setDeptRow({ id: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789', status: 'ACTIVE' });
    const r: any = await createRoleAction({ name: 'Test', code: 'TEST', sort: 1, deptId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789' });
    expect(r.success).toBe(true);
    expect(r.data).toBeDefined();
    expect(r.data.id).toBeDefined();
  });

  it('createRole: 缺 code → VALIDATION_ERROR 并包含错误码', async () => {
    const r: any = await createRoleAction({ name: 'X', code: '', sort: 1, deptId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789' } as any);
    expect(r.success).toBe(false);
    expect(r.error).toBe('VALIDATION_ERROR');
    expect(r.message).toBeDefined();
  });

  it('updateRole: 存在 → success 且返回更新后数据', async () => {
    mocks.setRow(roleRow);
    const r: any = await updateRoleAction('role-1', { name: 'Updated' } as any);
    expect(r.success).toBe(true);
    expect(r.data).toBeDefined();
  });

  it('updateRole: 不存在 → throw EntityNotFoundError', async () => {
    mocks.reset();
    mocks.setRows([{ id: 'dept-1' }]);
    await expect(updateRoleAction('bad', { name: 'X' } as any)).rejects.toThrow();
  });

  it('deleteRole: 非系统角色 → success 且包含确认消息', async () => {
    mocks.setRow(roleRow);
    const r: any = await deleteRoleAction('role-1');
    expect(r.success).toBe(true);
    expect(r.message).toBeDefined();
  });
});
