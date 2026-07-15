/**
 * Client 管理 API 集成测试（真实 DB）
 *
 * 使用 TRUNCATE CASCADE 模式隔离，验证 Client 列表/详情/Token 列表的端到端正确性。
 *
 * @req G-CLT-L, G-CLT-C, G-CLT-U, G-CLT-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedAdminUser, seedRootDept } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';

// ── 测试数据库 ──────────────────────────────────────
const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));
vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ userId: '00000000-0000-4000-8000-000000000101', claims: { sub: '', iss: '', aud: 'auth-sso', jti: '' } })),
  logServerDataRead: vi.fn(async () => {}),
  getUserRoleDeptIds: vi.fn().mockResolvedValue([]),
  canAccessDept: vi.fn(() => true),
  withPermission: (_options: any, handler: Function) => handler('00000000-0000-4000-8000-000000000101'),
}));
vi.mock('next/cache', () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

import { GET as ListClients } from '@/app/api/clients/route';
import { GET as GetClient } from '@/app/api/clients/[id]/route';
import { GET as ListTokens } from '@/app/api/clients/[id]/tokens/route';
import { createTestRequest, parseResponseJson } from '../helpers/test-utils';
import { db } from '@/infrastructure/db';

const CLIENT_ID_1 = 'test-client-1';
const CLIENT_ID_2 = 'test-client-2';
const USER_ID = '00000000-0000-4000-8000-000000000101';
const now = new Date();

function seedClients() {
  return [
    {
      clientId: CLIENT_ID_1,
      name: '测试应用',
      clientSecret: 'hashed_secret',
      redirectUris: ['http://localhost:4100/api/auth/callback'],
      scopes: 'openid profile email',
      homepageUrl: null,
      logoUrl: null,
      accessTokenTtl: 3600,
      refreshTokenTtl: 604800,
      status: 'ACTIVE' as const,
      isInternal: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      clientId: CLIENT_ID_2,
      name: '多回调应用',
      clientSecret: 'hashed_secret_2',
      redirectUris: ['http://localhost:4100/a', 'http://localhost:4100/b'],
      scopes: 'openid',
      homepageUrl: null,
      logoUrl: null,
      accessTokenTtl: 3600,
      refreshTokenTtl: 604800,
      status: 'ACTIVE' as const,
      isInternal: false,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function seedTokens() {
  return [
    {
      tokenHash: 'hash-token-1',
      clientId: CLIENT_ID_1,
      userId: USER_ID,
      scopes: 'openid profile',
      expiresAt: new Date('2027-01-01'),
      createdAt: now,
      updatedAt: now,
    },
    {
      tokenHash: 'hash-token-2',
      clientId: CLIENT_ID_1,
      userId: USER_ID,
      scopes: 'openid',
      expiresAt: new Date('2027-01-01'),
      createdAt: now,
      updatedAt: now,
    },
  ];
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  await td.cleanup();
});

describe('Client API', () => {
  describe('GET /api/clients', () => {
    it('返回分页 Client 列表', async () => {
      await seedTestData(td.db, { clients: seedClients() });

      const res = await ListClients(createTestRequest('/api/clients'));
      expect(res.status).toBe(200);

      const body = await parseResponseJson(res);
      expect(body.data).toHaveLength(2);
      expect(body.data[0].redirectUris).toBeInstanceOf(Array);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.total).toBe(2);
    });

    it('空结果返回空数组和 total 0', async () => {
      const body = await parseResponseJson(await ListClients(createTestRequest('/api/clients')));
      expect(body.data).toEqual([]);
      expect(body.pagination.total).toBe(0);
    });

    it('redirectUrls 原生数组直通返回', async () => {
      await seedTestData(td.db, { clients: [
        {
          clientId: CLIENT_ID_1,
          name: '测试应用',
          clientSecret: 'hashed_secret',
          redirectUris: ['http://localhost:4100/cb'],
          scopes: 'openid',
          homepageUrl: null,
          logoUrl: null,
          accessTokenTtl: 3600,
          refreshTokenTtl: 604800,
          status: 'ACTIVE' as const,
          isInternal: false,
          createdAt: now,
          updatedAt: now,
        },
        {
          clientId: CLIENT_ID_2,
          name: '多回调应用',
          clientSecret: 'hashed_secret_2',
          redirectUris: ['http://localhost:4100/a', 'http://localhost:4100/b'],
          scopes: 'openid',
          homepageUrl: null,
          logoUrl: null,
          accessTokenTtl: 3600,
          refreshTokenTtl: 604800,
          status: 'ACTIVE' as const,
          isInternal: false,
          createdAt: now,
          updatedAt: now,
        },
      ] });

      const body = await parseResponseJson(await ListClients(createTestRequest('/api/clients')));
      expect(body.data[0].redirectUris).toEqual(['http://localhost:4100/cb']);
      expect(body.data[1].redirectUris).toContain('http://localhost:4100/a');
    });
  });

  describe('GET /api/clients/[id]', () => {
    it('返回 Client 详情', async () => {
      await seedTestData(td.db, { clients: seedClients() });

      const res = await GetClient(
        createTestRequest('/api/clients/test-client-1'),
        { params: Promise.resolve({ id: CLIENT_ID_1 }) } as any,
      );
      const body = await parseResponseJson(res);
      expect(body.clientId).toBe(CLIENT_ID_1);
      expect(body.name).toBe('测试应用');
    });

    it('不存在的 Client 返回 404', async () => {
      const res = await GetClient(
        createTestRequest('/api/clients/nx'),
        { params: Promise.resolve({ id: 'nonexistent' }) } as any,
      );
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/clients/[id]/tokens', () => {
    it('返回分页 Token 列表', async () => {
      await seedTestData(td.db, {
        departments: seedRootDept(),
        users: seedAdminUser(),
        clients: seedClients(),
      });
      await db.insert(schema.accessTokens).values(seedTokens());

      const body = await parseResponseJson(await ListTokens(
        createTestRequest('/api/clients/test-client-1/tokens'),
        { params: Promise.resolve({ id: CLIENT_ID_1 }) } as any,
      ));
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data[0].scopes).toBeInstanceOf(Array);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.total).toBe(2);
    });

    it('不存在的 Client 返回 404', async () => {
      const res = await ListTokens(
        createTestRequest('/api/clients/nx/tokens'),
        { params: Promise.resolve({ id: 'nonexistent' }) } as any,
      );
      expect(res.status).toBe(404);
    });
  });
});
