/**
 * Client Server Actions 集成测试（真实 DB）
 *
 * 使用 TRUNCATE CASCADE 模式隔离，验证所有 CRUD 操作端到端正确性。
 *
 * @req G-CLT-C, G-CLT-U, G-CLT-D, G-CLT-SEC
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { EntityNotFoundError } from '@/domain/shared/errors';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedRootDept, seedTestUser } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';

// ── 测试数据库 ──────────────────────────────────────
const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));
vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ claims: { deptIds: ['00000000-0000-4000-8000-000000000001'] } })),
  logServerDataRead: vi.fn(async () => {}),
  canAccessDept: vi.fn(() => true),
  withAuth: (_o: any, h: Function) => async (...a: any[]) =>
    h({ userId: '00000000-0000-4000-8000-000000000101', claims: { deptIds: ['00000000-0000-4000-8000-000000000001'], permissions: [], roles: [] } }, ...a),
}));
vi.mock('@/lib/crypto', () => ({
  generateId: (_len?: number) => 'aaaaaaaa',
  generateClientId: () => 'client_test1234567890ab',
  generateClientSecret: () => 's'.repeat(64),
  hashClientSecret: (s: string) => `hash:${s}`,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { db } from '@/infrastructure/db';
import { createClientAction, updateClientAction, deleteClientAction, rotateClientSecretAction, revokeClientTokensAction } from '@/app/(dashboard)/clients/actions';

const TEST_CLIENT_ID = 'test-client-001';
const GENERATED_CLIENT_ID = 'client_test1234567890ab';
const USER_ID = '00000000-0000-4000-8000-000000000201';
const now = new Date();

function seedTestClient(overrides: Record<string, unknown> = {}) {
  return [{
    clientId: TEST_CLIENT_ID,
    name: 'Test App',
    clientSecret: 'hash:old-secret',
    redirectUris: ['https://example.com/cb'],
    scopes: 'openid profile email',
    homepageUrl: null,
    logoUrl: null,
    accessTokenTtl: 3600,
    refreshTokenTtl: 604800,
    status: 'ACTIVE',
    isInternal: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }];
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, { departments: seedRootDept() });
});

describe('Client Server Actions', () => {
  describe('createClientAction', () => {
    it('有效输入 → success 且 DB 包含 redirectUris', async () => {
      const r: any = await createClientAction({
        name: 'My App',
        redirectUris: ['https://a.example.com/cb'],
        scopes: 'openid',
        homepageUrl: null,
        logoUrl: null,
        accessTokenTtl: 3600,
        refreshTokenTtl: 604800,
      } as any);

      expect(r.success).toBe(true);
      expect(r.data.clientId).toBe(GENERATED_CLIENT_ID);
      expect(r.data.clientSecret).toBe('s'.repeat(64));

      const rows = await db.select().from(schema.clients);
      const client = rows.find(c => c.clientId === GENERATED_CLIENT_ID);
      expect(client).toBeDefined();
      expect(client!.name).toBe('My App');
      expect(client!.redirectUris).toEqual(['https://a.example.com/cb']);
      expect(client!.clientSecret).toBe('hash:' + 's'.repeat(64));
    });

    it('缺少 name → VALIDATION_ERROR', async () => {
      const r: any = await createClientAction({
        name: '',
        redirectUris: ['https://a.example.com/cb'],
        scopes: 'openid',
      } as any);

      expect(r.success).toBe(false);
      expect(r.error).toBeDefined();
      expect(r.message).toBeDefined();
    });
  });

  describe('updateClientAction', () => {
    it('存在的 client → success 且 DB 写入 name', async () => {
      await seedTestData(td.db, { clients: seedTestClient() } as any);

      const r: any = await updateClientAction(TEST_CLIENT_ID, {
        name: 'Updated',
        redirectUris: ['https://a.example.com/cb'],
        scopes: 'openid',
      } as any);

      expect(r.success).toBe(true);
      expect(r.data.id).toBe(TEST_CLIENT_ID);

      const rows = await db.select().from(schema.clients);
      const updated = rows.find(c => c.clientId === TEST_CLIENT_ID);
      expect(updated!.name).toBe('Updated');
    });

    it('不存在 → throw EntityNotFoundError', async () => {
      await expect(
        updateClientAction('nonexistent', { name: 'X' } as any)
      ).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe('deleteClientAction', () => {
    it('存在的 client → success 且 DB 中已删除', async () => {
      await seedTestData(td.db, { clients: seedTestClient() } as any);

      const r: any = await deleteClientAction(TEST_CLIENT_ID);

      expect(r.success).toBe(true);
      expect(r.data.id).toBe(TEST_CLIENT_ID);

      const rows = await db.select().from(schema.clients);
      expect(rows.find(c => c.clientId === TEST_CLIENT_ID)).toBeUndefined();
    });
  });

  describe('rotateClientSecretAction', () => {
    // @req G-CLT-SEC
    it('轮换密钥成功 → 返回新 secret 且 DB 写入哈希值', async () => {
      await seedTestData(td.db, { clients: seedTestClient() } as any);

      const r: any = await rotateClientSecretAction(TEST_CLIENT_ID);

      expect(r.success).toBe(true);
      expect(r.data.clientSecret).toBe('s'.repeat(64));

      const rows = await db.select().from(schema.clients);
      const updated = rows.find(c => c.clientId === TEST_CLIENT_ID);
      expect(updated!.clientSecret).toBe('hash:' + 's'.repeat(64));
    });
  });

  describe('revokeClientTokensAction', () => {
    it('撤销全部 token → success 且 revokedCount 正确', async () => {
      await seedTestData(td.db, {
        users: seedTestUser(),
        clients: seedTestClient(),
      } as any);
      await db.insert(schema.accessTokens).values([
        { tokenHash: 'hash-a1', clientId: TEST_CLIENT_ID, userId: USER_ID, scopes: 'openid', expiresAt: new Date(Date.now() + 3600000), createdAt: now, updatedAt: now },
        { tokenHash: 'hash-a2', clientId: TEST_CLIENT_ID, userId: USER_ID, scopes: 'openid', expiresAt: new Date(Date.now() + 3600000), createdAt: now, updatedAt: now },
      ]);

      const r: any = await revokeClientTokensAction(TEST_CLIENT_ID, [], true);

      expect(r.success).toBe(true);
      expect(r.data.revokedCount).toBe(2);

      const remaining = await db.select().from(schema.accessTokens);
      expect(remaining.length).toBe(0);
    });

    it('不存在 → throw EntityNotFoundError', async () => {
      await expect(
        revokeClientTokensAction('bad', [], false)
      ).rejects.toThrow(EntityNotFoundError);
    });
  });
});
