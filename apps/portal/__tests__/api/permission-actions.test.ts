/**
 * Permission Server Actions 单元测试
 *
 * @req D-PRM-C, D-PRM-U, D-PRM-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── 共享 DB mock（由 helpers/mock-db 工厂提供） ──────────────────────────
// createMockDb 在异步 vi.mock 工厂内通过动态 import 加载，避免 vi.mock 提升
// 早于顶层 import 的初始化顺序问题（Vitest 4）。结果存入 hoisted holder 供测试调用。
const holder = vi.hoisted<{ mockDb: ReturnType<typeof import('@/../__tests__/helpers/mock-db').createMockDb> | null }>(() => ({ mockDb: null }));

vi.mock('@/infrastructure/db', async () => {
  const { createMockDb } = await import('@/../__tests__/helpers/mock-db');
  holder.mockDb = createMockDb();
  return { db: holder.mockDb.db, schema: { permissions: {}, rolePermissions: {} } };
});
vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ claims: { deptIds: ['dept-1'] } })),
  logServerDataRead: vi.fn(async () => {}),
  canAccessDept: vi.fn(() => true),
 withAuth: (_o: any, h: Function) => async (...a: any[]) => h({ userId: 'admin-1' }, ...a) }));
vi.mock('@/lib/crypto', () => ({ generateUUID: () => 'aaaa-bbbb-cccc-dddd' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { createPermissionAction, updatePermissionAction, deletePermissionAction } from '@/app/(dashboard)/permissions/actions';

// mockDb 已由上面的异步 vi.mock 工厂填充（在静态 import 解析时执行）
const mockDb = holder.mockDb!;

const now = new Date();
const permRow = { id: 'perm-1', code: 'TEST_PERM', name: 'Test', resource: 'test', action: 'read', type: 'API' as const, status: 'ACTIVE' as const, description: '', clientId: null, parentId: null, sort: 0, createdAt: now, updatedAt: now };

describe('Permission Server Actions', () => {
  beforeEach(() => { vi.clearAllMocks(); mockDb.reset(); });
  it('create: 有效 → success', async () => { const r: any = await createPermissionAction({ code: 'NEW', name: 'New', resource: '/api/test', action: 'GET', type: 'API' } as any); expect(r.success).toBe(true); });
  it('create: 缺 code → error', async () => { const r: any = await createPermissionAction({ code: '', name: '', resource: '', action: '', type: '' } as any); expect(r.success).toBe(false); });
  it('update: 存在 → success', async () => { mockDb.setQueryResult([permRow]); const r: any = await updatePermissionAction('perm-1', { name: 'Updated' } as any); expect(r.success).toBe(true); });
  it('delete: 可删除 → success', async () => { mockDb.setQueryResult([permRow]); const r: any = await deletePermissionAction('perm-1'); expect(r.success).toBe(true); });
});
