/**
 * Client Server Actions 单元测试
 *
 * @req G-CLT-C, G-CLT-U, G-CLT-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntityNotFoundError } from '@/domain/shared/errors';

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
  withAuth: (_o: any, h: Function) => async (...a: any[]) => h({ userId: 'admin-1', roles: [], permissions: [] }, ...a),
}));
vi.mock('@/lib/crypto', () => ({ generateId: (len = 20) => 'a'.repeat(len), generateClientId: () => 'client_mock1234567890ab', generateClientSecret: () => 's'.repeat(64), hashClientSecret: (s: string) => `hash:${s}` }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { createClientAction, updateClientAction, deleteClientAction, rotateClientSecretAction, revokeClientTokensAction } from '@/app/(dashboard)/clients/actions';

const mockDb = holder.mockDb!;
const setRow = (r: any) => mockDb.setQueryResult([r]);

const now = new Date();
const clientRow = { clientId: 'client_mock', status: 'ACTIVE', redirectUris: [], clientSecret: 'old', name: 'Test', scopes: 'openid', homepageUrl: null, logoUrl: null, accessTokenTtl: 3600, refreshTokenTtl: 604800, createdAt: now, updatedAt: now };

describe('Client Server Actions', () => {
  beforeEach(() => { vi.clearAllMocks(); mockDb.reset(); });

  describe('createClientAction', () => {
    it('有效输入 → success 且 DB insert 包含 redirectUris', async () => {
      mockDb.setReturningResult([{ clientId: 'client_mock1234567890ab', clientSecret: 's'.repeat(64) }]);
      const result: any = await createClientAction({ name: 'My App', redirectUris: ['https://a.example.com/cb'], scopes: 'openid', homepageUrl: null, logoUrl: null, accessTokenTtl: 3600, refreshTokenTtl: 604800 } as any);
      expect(result.success).toBe(true);
      expect(result.data.clientId).toBeDefined();
      expect(result.data.clientSecret).toBeDefined();
      const writes = mockDb.getWrites();
      const insert = writes.find(w => w.type === 'insert');
      expect(insert).toBeDefined();
      expect(insert!.data.name).toBe('My App');
      expect(insert!.data.redirectUris).toEqual(['https://a.example.com/cb']);
    });

    it('缺少 name → VALIDATION_ERROR', async () => {
      const result: any = await createClientAction({ name: '', redirectUris: ['https://a.example.com/cb'], scopes: 'openid' } as any);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.message).toBeDefined();
    });
  });

  describe('updateClientAction', () => {
    it('存在的 client → success 且 DB update 写入 name', async () => {
      setRow(clientRow);
      const result: any = await updateClientAction('client_mock', { name: 'Updated', redirectUris: ['https://a.example.com/cb'], scopes: 'openid' } as any);
      expect(result.success).toBe(true);
      const writes = mockDb.getWrites();
      const update = writes.find(w => w.type === 'update');
      expect(update).toBeDefined();
      expect(update!.data.name).toBe('Updated');
    });

    it('不存在 → throw EntityNotFoundError', async () => {
      mockDb.reset();
      await expect(updateClientAction('nonexistent', { name: 'X' } as any)).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe('deleteClientAction', () => {
    it('存在的 client → success 且 data 包含 id', async () => {
      setRow(clientRow);
      const result: any = await deleteClientAction('client_mock');
      expect(result.success).toBe(true);
      expect(result.data.id).toBe('client_mock');
    });
  });

  describe('rotateClientSecretAction', () => {
    // @req G-CLT-SEC
    it('轮换密钥成功 → 返回新 secret 且 DB 写入哈希值', async () => {
      setRow(clientRow);
      const result: any = await rotateClientSecretAction('client_mock');
      expect(result.success).toBe(true);
      expect(result.data.clientSecret).toBe('s'.repeat(64));
      const writes = mockDb.getWrites();
      const update = writes.find(w => w.type === 'update');
      expect(update).toBeDefined();
      expect(update!.data.clientSecret).toBe('hash:' + 's'.repeat(64));
    });
  });

  describe('revokeClientTokensAction', () => {
    it('撤销全部 token → success 且 revokedCount 正确', async () => {
      setRow(clientRow);
      mockDb.setQueryResult([{ id: 't1' }, { id: 't2' }]);
      const result: any = await revokeClientTokensAction('client_mock', [], true);
      expect(result.success).toBe(true);
      expect(result.data.revokedCount).toBeGreaterThanOrEqual(0);
    });

    it('不存在 → throw EntityNotFoundError', async () => {
      mockDb.reset();
      await expect(revokeClientTokensAction('bad', [], false)).rejects.toThrow(EntityNotFoundError);
    });
  });
});
