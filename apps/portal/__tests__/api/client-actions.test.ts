/**
 * Client Server Actions 单元测试
 *
 * @req G-CLT-C, G-CLT-U, G-CLT-D
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
  return { db: holder.mockDb.db, schema: { clients: {}, accessTokens: {}, refreshTokens: {} } };
});
vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ claims: { deptIds: ['dept-1'] } })),
  logServerDataRead: vi.fn(async () => {}),
  canAccessDept: vi.fn(() => true),
 withAuth: (_o: any, h: Function) => async (...a: any[]) => h({ userId: 'admin-1', roles: [], permissions: [] }, ...a) }));
vi.mock('@/lib/crypto', () => ({ generateId: (len = 20) => 'a'.repeat(len), generateClientId: () => 'client_mock1234567890ab', generateClientSecret: () => 's'.repeat(64), hashClientSecret: (s: string) => `hash:${s}` }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { createClientAction, updateClientAction, deleteClientAction, rotateClientSecretAction, revokeClientTokensAction } from '@/app/(dashboard)/clients/actions';

// mockDb 已由上面的异步 vi.mock 工厂填充（在静态 import 解析时执行）
const mockDb = holder.mockDb!;
// setRow(r) → setQueryResult([r])；setRows(arr) → setQueryResult(arr)
const setRow = (r: any) => mockDb.setQueryResult([r]);
const setRows = (r: any[]) => mockDb.setQueryResult(r);

const now = new Date();
const clientRow = { clientId: 'client_mock', status: 'ACTIVE', redirectUris: [], clientSecret: 'old', name: 'Test', scopes: 'openid', homepageUrl: null, logoUrl: null, accessTokenTtl: 3600, refreshTokenTtl: 604800, createdAt: now, updatedAt: now };

describe('Client Server Actions', () => {
  beforeEach(() => { vi.clearAllMocks(); mockDb.reset(); });

  describe('createClientAction', () => {
    it('有效输入 → 返回 success', async () => {
      const result: any = await createClientAction({ name: 'My App', redirectUris: ['https://a.example.com/cb'], scopes: 'openid', homepageUrl: null, logoUrl: null, accessTokenTtl: 3600, refreshTokenTtl: 604800 } as any);
      expect(result.success).toBe(true);
    });
    it('缺少 name → 返回 VALIDATION_ERROR', async () => {
      const result: any = await createClientAction({ name: '', redirectUris: ['https://a.example.com/cb'], scopes: 'openid' } as any);
      expect(result.success).toBe(false);
    });
  });

  describe('updateClientAction', () => {
    it('存在的 client → 返回 success', async () => {
      setRow(clientRow);
      const result: any = await updateClientAction('client_mock', { name: 'Updated', redirectUris: ['https://a.example.com/cb'], scopes: 'openid' } as any);
      expect(result.success).toBe(true);
    });
    it('不存在的 client → 抛出 EntityNotFoundError', async () => {
      mockDb.reset();
      await expect(updateClientAction('nonexistent', { name: 'X' } as any)).rejects.toThrow();
    });
  });

  describe('deleteClientAction', () => {
    it('存在的 client → 返回 success', async () => {
      setRow(clientRow);
      const result: any = await deleteClientAction('client_mock');
      expect(result.success).toBe(true);
    });
  });

  describe('rotateClientSecretAction', () => {
    // @req G-CLT-SEC
    it('轮换密钥成功 → 返回新 secret 且 DB 写入哈希值', async () => {
      setRow(clientRow);
      const result: any = await rotateClientSecretAction('client_mock');
      expect(result.success).toBe(true);
      expect(result.data.clientSecret).toBeDefined();
      // 验证返回的是原始 secret（64 字符），不是哈希值
      expect(result.data.clientSecret).toBe('s'.repeat(64));
      // 验证 DB 写入了哈希后的密钥（hashClientSecret mock 返回 'hash:xxx'）
      const writes = mockDb.getWrites();
      const update = writes.find(w => w.type === 'update');
      expect(update).toBeDefined();
      expect(update!.data.clientSecret).toBe('hash:' + 's'.repeat(64));
    });
  });

  describe('revokeClientTokensAction', () => {
    it('撤销全部 token → 返回 revokedCount', async () => {
      setRow(clientRow);
      setRows([{ id: 't1' }, { id: 't2' }]);
      const result: any = await revokeClientTokensAction('client_mock', [], true);
      expect(result.success).toBe(true);
    });
  });
});
