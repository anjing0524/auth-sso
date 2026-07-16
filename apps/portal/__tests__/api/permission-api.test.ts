/**
 * 权限管理 API 集成测试（真实 DB）
 *
 * @req D-PRM-L, D-PRM-C, D-PRM-U, D-PRM-D
 * @req E-MNU-U, E-MNU-D, E-MNU-PB
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedRootDept } from '../helpers/seed-fixtures';
import { createTestRequest, parseResponseJson } from '../helpers/test-utils';
import * as schema from '@/db/schema';

const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));

const { mockWithPermission } = vi.hoisted(() => {
  const mockWithPermission = vi.fn(async (_options: any, handler: Function) => {
    return handler('00000000-0000-4000-8000-000000000101');
  });
  return { mockWithPermission };
});

vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ userId: '00000000-0000-4000-8000-000000000101', claims: { sub: '', iss: '', aud: 'auth-sso', jti: '' } })),
  logServerDataRead: vi.fn(async () => {}),
  getUserRoleDeptIds: vi.fn().mockResolvedValue([]),
  canAccessDept: vi.fn(() => true),
  withPermission: mockWithPermission,
}));

const cryptoMocks = vi.hoisted(() => {
  let _uuidCount = 0;
  return {
    generateUUID: vi.fn(() => {
      _uuidCount += 1;
      return `aabbccdd-eeff-4000-8000-${String(_uuidCount).padStart(12, '0')}`;
    }),
    resetCounters() { _uuidCount = 0; },
  };
});

vi.mock('@/lib/crypto', () => ({
  generateUUID: cryptoMocks.generateUUID,
  generateId: () => 'aaaaaaaa',
}));

vi.mock('@/lib/audit', () => ({
  logAuditEvent: vi.fn(async () => {}),
  getClientIP: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@/infrastructure/redis', () => ({}));

import { GET as ListPermissions } from '@/app/api/permissions/route';
import { GET as GetPermission } from '@/app/api/permissions/[id]/route';
import { POST as RegisterPermissions } from '@/app/api/permissions/register/route';

const REGISTRY_CLIENT_ID = 'registry-client';
const REGISTRY_CLIENT_SECRET = 'registry-secret';
const REGISTRY_CLIENT_SECRET_HASH = createHash('sha256').update(REGISTRY_CLIENT_SECRET).digest('hex');
const PERM_ID = '00000000-0000-4000-8000-000000000401';

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  vi.clearAllMocks();
  cryptoMocks.resetCounters();
  await td.cleanup();
  await seedTestData(td.db, { departments: seedRootDept() });
});

async function seedRegistryClient(overrides: Partial<typeof schema.clients.$inferInsert> = {}) {
  await td.db.insert(schema.clients).values({
    clientId: REGISTRY_CLIENT_ID,
    name: '权限注册客户端',
    clientSecret: REGISTRY_CLIENT_SECRET_HASH,
    redirectUris: ['http://localhost:3000/callback'],
    scopes: 'openid',
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

async function seedOtherClient() {
  await td.db.insert(schema.clients).values({
    clientId: 'other-client',
    name: '其他客户端',
    clientSecret: createHash('sha256').update('other-secret').digest('hex'),
    redirectUris: ['http://localhost:3000/callback'],
    scopes: 'openid',
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function seedPermission(overrides: Partial<typeof schema.permissions.$inferInsert> = {}) {
  await td.db.insert(schema.permissions).values({
    id: PERM_ID,
    code: 'portal:user:list',
    name: '用户列表',
    type: 'API',
    status: 'ACTIVE',
    sort: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

function createRegisterReq(
  permissions: any[],
  opts: { clientId?: string; clientSecret?: string; noAuth?: boolean } = {},
) {
  const { clientId = REGISTRY_CLIENT_ID, clientSecret = REGISTRY_CLIENT_SECRET, noAuth = false } = opts;
  const headers: Record<string, string> = {};
  if (!noAuth) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  }
  return createTestRequest('/api/permissions/register', { method: 'POST', headers, body: { permissions } });
}

describe('Permission API', () => {
  describe('GET /api/permissions', () => {
    it('返回全部权限列表', async () => {
      await seedPermission();
      await seedPermission({ id: '00000000-0000-4000-8000-000000000402', code: 'portal:role:list', name: '角色列表', sort: 2 });
      await seedPermission({ id: '00000000-0000-4000-8000-000000000403', code: 'portal:dept:list', name: '部门列表', sort: 3 });

      const body = await parseResponseJson(await ListPermissions(createTestRequest('/api/permissions')));
      expect(body.data).toHaveLength(3);
      expect(body.data[0].code).toBe('portal:user:list');
    });

    it('支持 type 过滤', async () => {
      await seedPermission();
      await td.db.insert(schema.permissions).values({
        id: '00000000-0000-4000-8000-000000000402',
        code: 'portal:dashboard',
        name: '仪表盘',
        type: 'PAGE',
        path: '/dashboard',
        clientId: null,
        status: 'ACTIVE',
        sort: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const body = await parseResponseJson(
        await ListPermissions(createTestRequest('/api/permissions', { searchParams: { type: 'API' } })),
      );
      expect(body.data).toHaveLength(1);
      expect(body.data[0].type).toBe('API');
    });

    it('空列表返回空数组', async () => {
      const body = await parseResponseJson(await ListPermissions(createTestRequest('/api/permissions')));
      expect(body.data).toEqual([]);
    });
  });

  describe('GET /api/permissions/[id]', () => {
    it('返回权限详情', async () => {
      await seedPermission();
      const body = await parseResponseJson(
        await GetPermission(createTestRequest(`/api/permissions/${PERM_ID}`), {
          params: Promise.resolve({ id: PERM_ID }),
        } as any),
      );
      expect(body.code).toBe('portal:user:list');
    });

    it('不存在返回 404', async () => {
      const res = await GetPermission(createTestRequest('/api/permissions/00000000-0000-4000-8000-000000000999'), {
        params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000999' }),
      } as any);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/permissions/register', () => {
    it('缺少 Basic Auth 返回 401', async () => {
      const res = await RegisterPermissions(createRegisterReq([], { noAuth: true }));
      expect(res.status).toBe(401);
    });

    it('Client 不存在返回 403', async () => {
      const res = await RegisterPermissions(
        createRegisterReq([{ code: 'portal:u:l', name: 'x', type: 'API' }], { clientId: 'bad', clientSecret: 'bad' }),
      );
      expect(res.status).toBe(403);
    });

    it('缺少 permissions 数组返回 400', async () => {
      await seedRegistryClient();
      const res = await RegisterPermissions(
        createTestRequest('/api/permissions/register', {
          method: 'POST',
          headers: {
            Authorization: 'Basic ' + Buffer.from(`${REGISTRY_CLIENT_ID}:${REGISTRY_CLIENT_SECRET}`).toString('base64'),
          },
          body: {},
        }),
      );
      expect(res.status).toBe(400);
    });

    it('完整同步权限树成功（新权限全部插入）', async () => {
      await seedRegistryClient();

      const res = await RegisterPermissions(
        createRegisterReq([
          { code: 'portal:user:list', name: '用户列表', type: 'API', sort: 1 },
          { code: 'portal:user:create', name: '创建用户', type: 'API', sort: 2 },
          { code: 'portal:system', name: '系统管理', type: 'API', sort: 0 },
          { code: 'portal:system:config', name: '系统配置', type: 'API', sort: 1 },
        ]),
      );
      const body = await parseResponseJson(res);

      expect(res.status).toBe(200);
      expect(body.inserted).toBe(4);
      expect(body.updated).toBe(0);
      expect(body.deprecated).toBe(0);
    });

    it('两阶段事务：新权限插入 + 旧权限更新 + 旧权限软删除', async () => {
      await seedRegistryClient();
      // 种子已有权限
      await td.db.insert(schema.permissions).values([
        {
          id: '00000000-0000-4000-8000-000000000411',
          code: 'portal:user:list', name: '旧用户列表', type: 'API',
          clientId: REGISTRY_CLIENT_ID,
          status: 'ACTIVE', sort: 0, createdAt: new Date(), updatedAt: new Date(),
        },
        {
          id: '00000000-0000-4000-8000-000000000412',
          code: 'portal:role:list', name: '旧角色列表', type: 'API',
          clientId: REGISTRY_CLIENT_ID,
          status: 'ACTIVE', sort: 1, createdAt: new Date(), updatedAt: new Date(),
        },
        {
          id: '00000000-0000-4000-8000-000000000413',
          code: 'portal:will:remain', name: '保留权限', type: 'API',
          clientId: REGISTRY_CLIENT_ID,
          status: 'ACTIVE', sort: 2, createdAt: new Date(), updatedAt: new Date(),
        },
      ]);

      const res = await RegisterPermissions(
        createRegisterReq([
          { code: 'portal:user:list', name: '更新后的用户列表', type: 'API' },
          { code: 'portal:will:remain', name: '保留权限', type: 'API' },
        ]),
      );
      const body = await parseResponseJson(res);

      expect(res.status).toBe(200);
      expect(body.inserted).toBe(0);
      expect(body.deprecated).toBeGreaterThanOrEqual(1);
      expect(body.updated).toBeGreaterThanOrEqual(1);
    });

    it('全局 code 冲突（被其他 client 占用）返回 409', async () => {
      await seedRegistryClient();
      await seedOtherClient();
      await td.db.insert(schema.permissions).values({
        id: '00000000-0000-4000-8000-000000000421',
        code: 'portal:user:list', name: '用户列表', type: 'API',
        clientId: 'other-client',
        status: 'ACTIVE', sort: 0, createdAt: new Date(), updatedAt: new Date(),
      });

      const res = await RegisterPermissions(
        createRegisterReq([{ code: 'portal:user:list', name: '用户列表', type: 'API' }]),
      );
      expect(res.status).toBe(409);
      const body = await parseResponseJson(res);
      expect(body.error).toBe('conflict');
      expect(body.message).toContain('portal:user:list');
    });

    it('批量内重复 code 返回验证错误', async () => {
      await seedRegistryClient();
      const res = await RegisterPermissions(
        createRegisterReq([
          { code: 'portal:user:list', name: '用户列表', type: 'API' },
          { code: 'portal:user:list', name: '重复', type: 'API' },
        ]),
      );
      expect(res.status).toBe(400);
    });

    it('层级权限树同步成功（父子关系透传）', async () => {
      await seedRegistryClient();

      const res = await RegisterPermissions(
        createRegisterReq([
          {
            code: 'portal:erp:orders', name: '订单管理', type: 'API', sort: 1,
            children: [
              { code: 'portal:erp:order:list', name: '订单列表', type: 'API', sort: 1 },
            ],
          },
        ]),
      );
      const body = await parseResponseJson(res);

      expect(res.status).toBe(200);
      expect(body.inserted).toBe(2);

      const rows = await td.db
        .select()
        .from(schema.permissions)
        .where(eq(schema.permissions.clientId, REGISTRY_CLIENT_ID));
      const parent = rows.find((r) => r.code === 'portal:erp:orders');
      const child = rows.find((r) => r.code === 'portal:erp:order:list');
      expect(parent).toBeDefined();
      expect(child).toBeDefined();
      expect(child!.parentId).toBe(parent!.id);
    });
  });
});
