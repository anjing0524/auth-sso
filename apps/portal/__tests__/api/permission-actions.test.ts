/**
 * Permission Server Actions 单元测试
 *
 * @req D-PRM-C, D-PRM-U, D-PRM-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  let _row: any = undefined; let _rows: any[] = [];
  const single = (): any => { const c: any = () => {}; c.then = (r: Function) => r(_row); return c; };
  const list = (): any => { const c: any = () => {}; c.then = (r: Function) => r(_rows); return new Proxy(c, { get(_t, p: string) { if (p === 'then' || p === 'catch') return c[p as keyof typeof c]; return () => list(); } }); };
  const insert = () => ({ values: (d: any) => ({ returning: () => Promise.resolve([{ ...d, id: 'mock-id' }]), then: (r: Function) => r(1) }) });
  const update = () => ({ set: () => ({ where: () => ({ then: (r: Function) => r(1) }) }) });
  const del = () => ({ where: () => ({ then: (r: Function) => r(1) }) });
  const queryProxy = new Proxy({} as any, { get() { return { findFirst: () => single() }; } });
  function makeTx() { return new Proxy({} as any, { get(_t, p: string) { if (p === 'select') return () => list(); if (p === 'insert') return insert; if (p === 'update') return update; if (p === 'delete') return del; if (p === 'query') return queryProxy; return undefined; } }); }
  const mockDb = new Proxy({} as any, { get(_t, p: string) { if (p === 'select') return () => list(); if (p === 'insert') return insert; if (p === 'update') return update; if (p === 'delete') return del; if (p === 'transaction') return (h: Function) => h(makeTx()); if (p === 'query') return queryProxy; return undefined; } });
  return { mockDb, setRow(r: any) { _row = r; _rows = r ? [r] : []; }, reset() { _row = undefined; _rows = []; } };
});

vi.mock('@/infrastructure/db', () => ({ db: mocks.mockDb, schema: { permissions: {}, rolePermissions: {} } }));
vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ claims: { deptIds: ['dept-1'] } })),
  logServerDataRead: vi.fn(async () => {}),
  canAccessDept: vi.fn(() => true),
 withAuth: (_o: any, h: Function) => async (...a: any[]) => h({ userId: 'admin-1' }, ...a) }));
vi.mock('@/lib/crypto', () => ({ generateUUID: () => 'aaaa-bbbb-cccc-dddd' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { createPermissionAction, updatePermissionAction, deletePermissionAction } from '@/app/(dashboard)/permissions/actions';

const now = new Date();
const permRow = { id: 'perm-1', code: 'TEST_PERM', name: 'Test', resource: 'test', action: 'read', type: 'API' as const, status: 'ACTIVE' as const, description: '', clientId: null, parentId: null, sort: 0, createdAt: now, updatedAt: now };

describe('Permission Server Actions', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.reset(); });
  it('create: 有效 → success', async () => { const r: any = await createPermissionAction({ code: 'NEW', name: 'New', resource: '/api/test', action: 'GET', type: 'API' } as any); expect(r.success).toBe(true); });
  it('create: 缺 code → error', async () => { const r: any = await createPermissionAction({ code: '', name: '', resource: '', action: '', type: '' } as any); expect(r.success).toBe(false); });
  it('update: 存在 → success', async () => { mocks.setRow(permRow); const r: any = await updatePermissionAction('perm-1', { name: 'Updated' } as any); expect(r.success).toBe(true); });
  it('delete: 可删除 → success', async () => { mocks.setRow(permRow); const r: any = await deletePermissionAction('perm-1'); expect(r.success).toBe(true); });
});
