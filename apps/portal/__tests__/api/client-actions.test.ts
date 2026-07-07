/**
 * Client Server Actions 单元测试
 *
 * @req G-CLT-C, G-CLT-U, G-CLT-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  let _row: any = undefined;
  let _rows: any[] = [];

  const single = (): any => { const c: any = () => {}; c.then = (r: Function) => r(_row); return c; };
  const list = (): any => { const c: any = () => {}; c.then = (r: Function) => r(_rows); return new Proxy(c, { get(_t, p: string) { if (p === 'then' || p === 'catch') return c[p as keyof typeof c]; return () => list(); } }); };
  const returning = (d: any) => ({ returning: () => Promise.resolve([d]), then: (r: Function) => r(1) });
  const insert = () => ({ values: (d: any) => returning({ ...d, id: 'mock-id' }) });
  const update = () => ({ set: () => ({ where: () => returning({}) }) });
  const del = () => ({ where: () => ({ returning: () => Promise.resolve([]), then: (r: Function) => r(1) }) });
  const queryProxy = new Proxy({} as any, { get() { return { findFirst: () => single() }; } });

  function makeTx() {
    return new Proxy({} as any, {
      get(_t, p: string) {
        if (p === 'select' || p === 'selectDistinct') return () => list();
        if (p === 'insert') return insert;
        if (p === 'update') return update;
        if (p === 'delete') return del;
        if (p === 'query') return queryProxy;
        return undefined;
      },
    });
  }

  const mockDb = new Proxy({} as any, {
    get(_t, p: string) {
      if (p === 'select' || p === 'selectDistinct') return () => list();
      if (p === 'insert') return insert;
      if (p === 'update') return update;
      if (p === 'delete') return del;
      if (p === 'transaction') return (h: Function) => h(makeTx());
      if (p === 'query') return queryProxy;
      return undefined;
    },
  });

  return {
    mockDb,
    setRow(r: any) { _row = r; _rows = r ? [r] : []; },
    setRows(r: any[]) { _rows = r; _row = r[0]; },
    reset() { _row = undefined; _rows = []; },
  };
});

vi.mock('@/infrastructure/db', () => ({ db: mocks.mockDb, schema: { clients: {}, accessTokens: {}, refreshTokens: {} } }));
vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ claims: { deptIds: ['dept-1'] } })),
  logServerDataRead: vi.fn(async () => {}),
  canAccessDept: vi.fn(() => true),
 withAuth: (_o: any, h: Function) => async (...a: any[]) => h({ userId: 'admin-1', roles: [], permissions: [] }, ...a) }));
vi.mock('@/lib/crypto', () => ({ generateId: (len = 20) => 'a'.repeat(len), generateClientId: () => 'client_mock1234567890ab', generateClientSecret: () => 's'.repeat(64), hashClientSecret: (s: string) => `hash:${s}` }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { createClientAction, updateClientAction, deleteClientAction, rotateClientSecretAction, revokeClientTokensAction } from '@/app/(dashboard)/clients/actions';

const now = new Date();
const clientRow = { clientId: 'client_mock', status: 'ACTIVE', redirectUris: [], clientSecret: 'old', name: 'Test', scopes: 'openid', homepageUrl: null, logoUrl: null, accessTokenTtl: 3600, refreshTokenTtl: 604800, createdAt: now, updatedAt: now };

describe('Client Server Actions', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.reset(); });

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
      mocks.setRow(clientRow);
      const result: any = await updateClientAction('client_mock', { name: 'Updated', redirectUris: ['https://a.example.com/cb'], scopes: 'openid' } as any);
      expect(result.success).toBe(true);
    });
    it('不存在的 client → 抛出 EntityNotFoundError', async () => {
      mocks.reset();
      await expect(updateClientAction('nonexistent', { name: 'X' } as any)).rejects.toThrow();
    });
  });

  describe('deleteClientAction', () => {
    it('存在的 client → 返回 success', async () => {
      mocks.setRow(clientRow);
      const result: any = await deleteClientAction('client_mock');
      expect(result.success).toBe(true);
    });
  });

  describe('rotateClientSecretAction', () => {
    it('存在的 client → 返回新 secret', async () => {
      mocks.setRow(clientRow);
      const result: any = await rotateClientSecretAction('client_mock');
      expect(result.success).toBe(true);
    });
  });

  describe('rotateClientSecretAction', () => {
    // @req G-CLT-SEC
    it('轮换密钥成功 → 返回新 secret', async () => {
      mocks.setRow(clientRow);
      const result: any = await rotateClientSecretAction('client_mock');
      expect(result.success).toBe(true);
      expect(result.data.clientSecret).toBeDefined();
      // 验证返回的是原始 secret（64 字符 hex），不是哈希值
      expect(result.data.clientSecret).toBe('s'.repeat(64));
    });
  });

  describe('revokeClientTokensAction', () => {
    it('撤销全部 token → 返回 revokedCount', async () => {
      mocks.setRow(clientRow);
      mocks.setRows([{ id: 't1' }, { id: 't2' }]);
      const result: any = await revokeClientTokensAction('client_mock', [], true);
      expect(result.success).toBe(true);
    });
  });
});
