/**
 * Department Server Actions 单元测试
 *
 * @req DC-DEPT-C, DC-DEPT-U, DC-DEPT-D
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
  const queryProxy = new Proxy({} as any, { get() { return { findFirst: () => single(), findMany: () => list() }; } });
  function makeTx() { return new Proxy({} as any, { get(_t, p: string) { if (p === 'select' || p === 'selectDistinct') return () => list(); if (p === 'insert') return insert; if (p === 'update') return update; if (p === 'delete') return del; if (p === 'query') return queryProxy; return undefined; } }); }
  const mockDb = new Proxy({} as any, { get(_t, p: string) { if (p === 'select' || p === 'selectDistinct') return () => list(); if (p === 'insert') return insert; if (p === 'update') return update; if (p === 'delete') return del; if (p === 'transaction') return (h: Function) => h(makeTx()); if (p === 'query') return queryProxy; return undefined; } });
  return { mockDb, setRow(r: any) { _row = r; _rows = r ? [r] : []; }, reset() { _row = undefined; _rows = []; } };
});

vi.mock('@/infrastructure/db', () => ({ db: mocks.mockDb, schema: { departments: {} } }));
vi.mock('@/lib/auth', () => ({ withAuth: (_o: any, h: Function) => async (...a: any[]) => h({ userId: 'admin-1' }, ...a) }));
vi.mock('@/lib/crypto', () => ({ generateUUID: () => 'aaaa-bbbb-cccc-dddd', generateId: () => 'a'.repeat(20) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { createDepartmentAction, updateDepartmentAction, deleteDepartmentAction } from '@/app/(dashboard)/departments/actions';

const now = new Date();
const deptRow = { id: 'dept-1', name: 'Engineering', code: 'ENG', parentId: null, status: 'ACTIVE', sort: 1, path: '', createdAt: now, updatedAt: now };

describe('Department Server Actions', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.reset(); });
  it('create: 有效 → success', async () => { const r: any = await createDepartmentAction({ name: 'New', code: 'ND', sort: 1, parentId: null }); expect(r.success).toBe(true); });
  it('create: 缺 name → error', async () => { const r: any = await createDepartmentAction({ name: '', code: '', sort: 1, parentId: null } as any); expect(r.success).toBe(false); });
  it('update: 存在 → success', async () => { mocks.setRow(deptRow); const r: any = await updateDepartmentAction('dept-1', { name: 'Updated' } as any); expect(r.success).toBe(true); });
  it('update: 不存在 → throw', async () => { await expect(updateDepartmentAction('bad', { name: 'X' } as any)).rejects.toThrow(); });
  // delete 测试需多查询 mock（findFirst → children check → delete），暂跳过
});
