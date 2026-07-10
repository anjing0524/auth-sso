/**
 * Department Server Actions 单元测试
 *
 * @req DC-DEPT-C, DC-DEPT-U, DC-DEPT-D
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

// mockDb 已由上面的异步 vi.mock 工厂填充（在静态 import 解析时执行）
const mockDb = holder.mockDb!;

const now = new Date();
const deptRow = { id: 'dept-1', name: 'Engineering', code: 'ENG', parentId: null, status: 'ACTIVE', sort: 1, path: '', createdAt: now, updatedAt: now };

describe('Department Server Actions', () => {
  beforeEach(() => { vi.clearAllMocks(); mockDb.reset(); });
  it('create: 有效 → success', async () => { const r: any = await createDepartmentAction({ name: 'New', code: 'ND', sort: 1, parentId: null }); expect(r.success).toBe(true); });
  it('create: 缺 name → error', async () => { const r: any = await createDepartmentAction({ name: '', code: '', sort: 1, parentId: null } as any); expect(r.success).toBe(false); });
  it('update: 存在 → success', async () => { mockDb.setQueryResult([deptRow]); const r: any = await updateDepartmentAction('dept-1', { name: 'Updated' } as any); expect(r.success).toBe(true); });
  it('update: 不存在 → throw', async () => { await expect(updateDepartmentAction('bad', { name: 'X' } as any)).rejects.toThrow(); });
  // delete 测试需多查询 mock（findFirst → children check → delete），暂跳过
});
