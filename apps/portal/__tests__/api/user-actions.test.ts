/**
 * User Server Actions 单元测试
 *
 * @req DC-USR-C, DC-USR-U, DC-USR-D
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
  return { db: holder.mockDb.db, schema: { users: {}, userRoles: {} } };
});
vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ claims: { deptIds: ['dept-1'] } })),
  logServerDataRead: vi.fn(async () => {}),
  canAccessDept: vi.fn(() => true),
 withAuth: (_o: any, h: Function) => async (...a: any[]) => h({ userId: 'admin-1', claims: { deptIds: ['dept-1'], permissions: [], roles: [] } }, ...a), withPermission: (_o: any, _r: any, h: Function) => async (...a: any[]) => h('admin-1', ...a) }));
vi.mock('@/lib/crypto', () => ({ generateUUID: () => 'aaaa-bbbb-cccc-dddd', generateId: (len = 20) => 'a'.repeat(len), hashToken: (t: string) => t }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock('@/infrastructure/redis', () => ({}));

import { createUserAction, updateUserAction, toggleUserStatusAction, deleteUserAction } from '@/app/(dashboard)/users/actions';

// mockDb 已由上面的异步 vi.mock 工厂填充（在静态 import 解析时执行）
const mockDb = holder.mockDb!;

const now = new Date();
const userRow = { id: 'user-1', username: 'testuser', name: 'Test', email: 'test@example.com', status: 'ACTIVE', passwordHash: '$2a$10$hash', deptId: null, avatarUrl: null, emailVerified: null, lastLoginAt: null, deletedAt: null, createdAt: now, updatedAt: now };

describe('User Server Actions', () => {
  beforeEach(() => { vi.clearAllMocks(); mockDb.reset(); });
  it('create: 有效 → success', async () => { const r: any = await createUserAction({ username: 'new', name: 'New', password: 'Pass123!', email: 'new@t.com' } as any); expect(r.success).toBe(true); });
  it('create: 缺 username → error', async () => { const r: any = await createUserAction({ username: '', name: '', password: '', email: '' } as any); expect(r.success).toBe(false); });
  it('update: 存在 → success', async () => { mockDb.setQueryResult([userRow]); const r: any = await updateUserAction('user-1', { name: 'Updated' } as any); expect(r.success).toBe(true); });
  it('toggle: 锁定 → success', async () => { mockDb.setQueryResult([userRow]); const r: any = await toggleUserStatusAction('user-1'); expect(r.success).toBe(true); });
  it('delete: 可删除 → success', async () => { mockDb.setQueryResult([userRow]); const r: any = await deleteUserAction('user-1'); expect(r.success).toBe(true); });
});
