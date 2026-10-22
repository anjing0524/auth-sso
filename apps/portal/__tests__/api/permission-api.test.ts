/**
 * 权限管理 API 集成测试（真实 DB）
 *
 * @req D-PRM-L, D-PRM-C, D-PRM-U, D-PRM-D
 * @req E-MNU-U, E-MNU-D, E-MNU-PB
 * @vitest-environment node
 */
import { COMMON_ERRORS, PERMISSION_ERRORS } from '@auth-sso/contracts';
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedRootDept, seedTestUser, seedUserRoleBinding } from '../helpers/seed-fixtures';
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

// @allow-module-mock @/lib/auth auth-bypass: 本文件被测语义不依赖登录/授权链路，mock 仅用于构造"已登录/已授权"的请求上下文（依赖它的断言：permission-api.test.ts 全部用例）
vi.mock(import('@/lib/auth'), async (importOriginal): Promise<Partial<typeof authModule>> => {
  const actual = await importOriginal();
  return { ...actual,
    resolveIdentity: vi.fn(async () => ({ userId: '00000000-0000-4000-8000-000000000101', expiresAt: null, issuedAt: null })),
    logServerDataRead: vi.fn(async () => {}),
    withPermission: mockWithPermission,
};
});

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

// @allow-module-mock @/lib/crypto input-fixture: 只覆盖「确定性 ID」这类输入，其余导出（含 hashToken）走真身
vi.mock(import('@/lib/crypto'), async (importOriginal): Promise<Partial<typeof cryptoModule>> => {
  const actual = await importOriginal();
  // 只覆盖「确定性 ID」，其余导出（含 hashToken 的真实 sha256）走真身：
  // 整体替换会让未列出的导出变成 undefined，而注解却声称它们走真实实现
  return {
    ...actual,
    generateUUID: cryptoMocks.generateUUID,
    generateId: () => 'aaaaaaaa',
  };
});


vi.mock('@/infrastructure/redis', () => ({}));

const { mockInvalidateFromRoute } = vi.hoisted(() => ({ mockInvalidateFromRoute: vi.fn() }));

// @allow-module-mock @/lib/cache-invalidation infra-boundary: 只观测「是否触发写后失效」这一旁路副作用，其余导出走真身；原语选择与资源表由 cache-invalidation.test.ts 覆盖
vi.mock(import('@/lib/cache-invalidation'), async (importOriginal): Promise<Partial<typeof cacheInvalidationModule>> => {
  const actual = await importOriginal();
  return { ...actual, invalidateResourceFromRoute: mockInvalidateFromRoute };
});

import { GET as ListPermissions } from '@/app/api/permissions/route';
import { GET as GetPermission } from '@/app/api/permissions/[id]/route';
import { GET as GetPermissionImpact } from '@/app/api/permissions/[id]/impact/route';
import { POST as RegisterPermissions } from '@/app/api/permissions/register/route';
import type * as authModule from '@/lib/auth';
import type * as cryptoModule from '@/lib/crypto';
import type * as cacheInvalidationModule from '@/lib/cache-invalidation';


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

    it('按请求页返回权限并保留总数', async () => {
      await seedPermission({ id: '00000000-0000-4000-8000-000000000411', code: 'portal:user:list', sort: 1 });
      await seedPermission({ id: '00000000-0000-4000-8000-000000000412', code: 'portal:role:list', sort: 2 });
      await seedPermission({ id: '00000000-0000-4000-8000-000000000413', code: 'portal:department:list', sort: 3 });

      const body = await parseResponseJson(await ListPermissions(
        createTestRequest('/api/permissions', { searchParams: { page: '2', pageSize: '1' } }),
      ));

      expect(body.pagination).toEqual({ page: 2, pageSize: 1, total: 3, totalPages: 3 });
      expect(body.data).toHaveLength(1);
      expect(body.data[0].code).toBe('portal:role:list');
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

    it('不存在返回 404，且携带**统一码** AUTH_SSO_1004（docs/spec/API.md:44）', async () => {
      const res = await GetPermission(createTestRequest('/api/permissions/00000000-0000-4000-8000-000000000999'), {
        params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000999' }),
      } as any);

      expect(res.status).toBe(404);
      // 统一码：资源类型由 URL 表达，实体级 not-found 码不增加信息（#82 统一了 5 个路由）
      expect((await res.json()).error).toBe(COMMON_ERRORS.NOT_FOUND);
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
      // 这里此前断言 `'conflict'` —— 一个**词表外**的字面量（route 直接拼字符串进响应体）。
      // 2026-10-15 巡检候选 4 把 restError 的 code 收窄为 ErrorCode 后，它编译不过，
      // 遂改为契约里的专属冲突码（409）。
      expect(body.error).toBe(PERMISSION_ERRORS.PERMISSION_ALREADY_EXISTS);
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

    it('同步确有变更 → 触发 route 版写后失效', async () => {
      await seedRegistryClient();

      const res = await RegisterPermissions(
        createRegisterReq([{ code: 'portal:user:list', name: '用户列表', type: 'API', sort: 1 }]),
      );
      const body = await parseResponseJson(res);

      expect(body.inserted).toBe(1);
      expect(mockInvalidateFromRoute).toHaveBeenCalledWith('permissions');
    });

    it('幂等重复上报（零变更）→ 不触发失效，避免白白打掉 hours 档缓存', async () => {
      await seedRegistryClient();

      // 第一次：真实插入
      await RegisterPermissions(
        createRegisterReq([{ code: 'portal:user:list', name: '用户列表', type: 'API', sort: 1 }]),
      );
      mockInvalidateFromRoute.mockClear();

      // 第二次：与库中完全一致 → inserted / updated / deprecated 全为 0
      const res = await RegisterPermissions(
        createRegisterReq([{ code: 'portal:user:list', name: '用户列表', type: 'API', sort: 1 }]),
      );
      const body = await parseResponseJson(res);

      expect(body).toMatchObject({ inserted: 0, updated: 0, deprecated: 0 });
      expect(mockInvalidateFromRoute).not.toHaveBeenCalled();
    });
  });
  describe('GET /api/permissions/[id]/impact', () => {
    const ROLE_ID = '00000000-0000-4000-8000-000000000501';
    const CHILD_ID = '00000000-0000-4000-8000-000000000402';

    async function seedImpactFixture() {
      await seedPermission({ id: PERM_ID, code: 'portal:menu:impact', name: '影响面页', type: 'PAGE', path: '/impact' });
      await seedPermission({ id: CHILD_ID, parentId: PERM_ID, code: 'portal:menu:impact:child', name: '影响面子页', type: 'PAGE', path: '/impact/child' });
      await td.db.insert(schema.roles).values({
        id: ROLE_ID, name: '影响面角色', code: 'IMPACT_ROLE',
        deptId: '00000000-0000-4000-8000-000000000001',
        isSystem: false, status: 'ACTIVE', sort: 0, createdAt: new Date(), updatedAt: new Date(),
      });
      await td.db.insert(schema.rolePermissions).values([
        { roleId: ROLE_ID, permissionId: PERM_ID, createdAt: new Date() },
        { roleId: ROLE_ID, permissionId: CHILD_ID, createdAt: new Date() },
      ]);
      await td.db.insert(schema.users).values(seedTestUser());
      await td.db.insert(schema.userRoles).values(seedUserRoleBinding('00000000-0000-4000-8000-000000000201', ROLE_ID));
    }

    it('返回级联后代/角色/用户影响面（去重计数）', async () => {
      await seedImpactFixture();
      const body = await parseResponseJson(
        await GetPermissionImpact(createTestRequest(`/api/permissions/${PERM_ID}/impact`), {
          params: Promise.resolve({ id: PERM_ID }),
        } as any),
      );
      expect(body).toMatchObject({ descendants: 1, roles: 1, users: 1 });
    });

    it('不存在的权限返回 404', async () => {
      const res = await GetPermissionImpact(
        createTestRequest('/api/permissions/00000000-0000-4000-8000-000000009999/impact'),
        { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000009999' }) } as any,
      );
      expect(res.status).toBe(404);
    });

    it('非法 UUID 返回 400，不把格式错误下沉为 500', async () => {
      const res = await GetPermissionImpact(
        createTestRequest('/api/permissions/not-a-uuid/impact'),
        { params: Promise.resolve({ id: 'not-a-uuid' }) } as any,
      );
      expect(res.status).toBe(400);
    });
  });
});
