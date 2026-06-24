/**
 * User Server Actions 单元测试
 *
 * @req DC-USR-C, DC-USR-U, DC-USR-D
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

vi.mock('@/infrastructure/db', () => ({ db: mocks.mockDb, schema: { users: {}, userRoles: {} } }));
vi.mock('@/lib/auth', () => ({ withAuth: (_o: any, h: Function) => async (...a: any[]) => h({ userId: 'admin-1', roles: [], permissions: [] }, ...a), withPermission: (_o: any, h: Function) => async (...a: any[]) => h('admin-1', ...a) }));
vi.mock('@/lib/crypto', () => ({ generateUUID: () => 'aaaa-bbbb-cccc-dddd', generateId: (len = 20) => 'a'.repeat(len), hashToken: (t: string) => t }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock('@/infrastructure/redis', () => ({}));

import { createUserAction, updateUserAction, toggleUserStatusAction, deleteUserAction } from '@/app/(dashboard)/users/actions';

const now = new Date();
const userRow = { id: 'user-1', username: 'testuser', name: 'Test', email: 'test@example.com', status: 'ACTIVE', passwordHash: '$2a$10$hash', deptId: null, avatarUrl: null, emailVerified: null, lastLoginAt: null, deletedAt: null, createdAt: now, updatedAt: now };

describe('User Server Actions', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.reset(); });
  it('create: 有效 → success', async () => { const r: any = await createUserAction({ username: 'new', name: 'New', password: 'Pass123!', email: 'new@t.com' } as any); expect(r.success).toBe(true); });
  it('create: 缺 username → error', async () => { const r: any = await createUserAction({ username: '', name: '', password: '', email: '' } as any); expect(r.success).toBe(false); });
  it('update: 存在 → success', async () => { mocks.setRow(userRow); const r: any = await updateUserAction('user-1', { name: 'Updated' } as any); expect(r.success).toBe(true); });
  it('toggle: 锁定 → success', async () => { mocks.setRow(userRow); const r: any = await toggleUserStatusAction('user-1'); expect(r.success).toBe(true); });
  it('delete: 可删除 → success', async () => { mocks.setRow(userRow); const r: any = await deleteUserAction('user-1'); expect(r.success).toBe(true); });
});
