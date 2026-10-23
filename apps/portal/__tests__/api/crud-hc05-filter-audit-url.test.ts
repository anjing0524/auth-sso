/**
 * H-C-05（users/clients REST 过滤参数白名单 → 400）+ H-31（clients tokens DELETE
 * malformed JSON → 400）+ H-C-07（审计记录公网 origin 而非容器内部 origin）
 *
 * @req H-ACL-002（参数不落 DB 造成 500 的排除）, J-LOG-001
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import {
  seedAdminUser, seedRootDept, seedSuperAdminRole, seedUserRoleBinding, seedPortalClient,
} from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';
import type * as permModule from '@/lib/auth/check-permission';

const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));
// @allow-module-mock @/lib/auth/check-permission auth-bypass: 只为进入 handler 伪造"已授权"上下文；真实 withPermission（错误映射）、真实 DB 与真实审计写入全程参与（依赖它的断言：crud-hc05-filter-audit-url.test.ts 全部用例）
vi.mock(import('@/lib/auth/check-permission'), async (importOriginal): Promise<Partial<typeof permModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    checkPermission: async () => ({ authorized: true, userId: '00000000-0000-4000-8000-000000000101' }),
    requirePermission: async () => ({ userId: '00000000-0000-4000-8000-000000000101' }),
  };
});
// next/cache 在测试环境无缓存语义：提供同名依赖即可（vitest.setup.ts 已整体替换，这里显式化便于定位）
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), cacheLife: vi.fn(), cacheTag: vi.fn() }));

import { GET as getClients } from '@/app/api/clients/route';
import { DELETE as deleteClientTokens } from '@/app/api/clients/[id]/tokens/route';
import { publicUrlFromRequest } from '@/lib/audit';

/**
 * users route → users/data → db/user-queries.ts 在**模块顶层**读取 schema；
 * 而 vi.mock 的 db 工厂要等 `td` 初始化。故 users route 必须在 beforeAll 里动态 import。
 */
let getUsers: typeof import('@/app/api/users/route').GET;

const ADMIN_ID = '00000000-0000-4000-8000-000000000101';
const ROOT_DEPT_ID = '00000000-0000-4000-8000-000000000001';
const ROLE_ID = '00000000-0000-4000-8000-000000000301';
const CLIENT_ID = 'client_crud_test_000001';

const get = (path: string) => new NextRequest(`http://localhost:4100${path}`);

beforeAll(async () => {
  await td.connect();
  ({ GET: getUsers } = await import('@/app/api/users/route'));
});
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedAdminUser(),
    roles: seedSuperAdminRole({ deptId: ROOT_DEPT_ID }),
    userRoles: seedUserRoleBinding(ADMIN_ID, ROLE_ID),
    clients: seedPortalClient({ clientId: CLIENT_ID }),
  });
});

describe('H-C-05 — REST 列表过滤参数白名单（非法值必须 400，不落 DB）', () => {
  it('GET /api/users?status=BOGUS → 400', async () => {
    const res = await getUsers(get('/api/users?status=BOGUS'));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('AUTH_SSO_1005');
  });

  it('GET /api/users?deptId=not-a-uuid → 400', async () => {
    const res = await getUsers(get('/api/users?deptId=not-a-uuid'));
    expect(res.status).toBe(400);
  });

  it('GET /api/users?status=ALL → 200（合法白名单值）', async () => {
    const res = await getUsers(get('/api/users?status=ALL'));
    expect(res.status).toBe(200);
  });

  it('GET /api/clients?status=BOGUS → 400（此前静默忽略返回全量）', async () => {
    const res = await getClients(get('/api/clients?status=BOGUS'));
    expect(res.status).toBe(400);
  });

  it('GET /api/clients?status=ACTIVE → 200', async () => {
    const res = await getClients(get('/api/clients?status=ACTIVE'));
    expect(res.status).toBe(200);
  });
});

describe('H-31 — clients tokens DELETE malformed JSON → 400', () => {
  it('malformed JSON → 400 VALIDATION_ERROR', async () => {
    const req = new NextRequest(`http://localhost:4100/api/clients/${CLIENT_ID}/tokens`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: '{bad json' as never,
    });
    const res = await deleteClientTokens(req, { params: Promise.resolve({ id: CLIENT_ID }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('AUTH_SSO_1005');
  });

  it('tokenIds 非数组 → 400（不再静默当 revokeAll）', async () => {
    const req = new NextRequest(`http://localhost:4100/api/clients/${CLIENT_ID}/tokens`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tokenIds: 'nope' }),
    });
    const res = await deleteClientTokens(req, { params: Promise.resolve({ id: CLIENT_ID }) });
    expect(res.status).toBe(400);
  });
});

describe('H-C-07 — 审计记录公网 origin（X-Forwarded-Host/Proto 由 Gateway 权威覆写）', () => {
  it('unit: publicUrlFromRequest 用转发头重建公网 URL', () => {
    const req = {
      url: 'https://0.0.0.0:4000/api/clients/abc/tokens?x=1',
      headers: new Headers({
        'x-forwarded-host': 'sso.example.com',
        'x-forwarded-proto': 'https',
      }),
    };
    expect(publicUrlFromRequest(req)).toBe('https://sso.example.com/api/clients/abc/tokens?x=1');
  });

  it('unit: 缺转发头时退化为 path（不写容器内部 origin）', () => {
    const req = { url: 'https://0.0.0.0:4000/api/x', headers: new Headers() };
    expect(publicUrlFromRequest(req)).toBe('/api/x');
  });

  it('route: 撤销 tokens 的审计行 url 是公网 origin，而非 https://0.0.0.0:4000', async () => {
    const req = new NextRequest(`http://localhost:4100/api/clients/${CLIENT_ID}/tokens`, {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-host': 'sso.example.com',
        'x-forwarded-proto': 'https',
        'x-forwarded-for': '203.0.113.9',
        'user-agent': 'vitest',
      },
      body: JSON.stringify({ revokeAll: true }),
    });
    const res = await deleteClientTokens(req, { params: Promise.resolve({ id: CLIENT_ID }) });
    expect(res.status).toBe(200);

    const rows = await td.db.select({
      url: schema.auditLogs.url,
      operation: schema.auditLogs.operation,
      params: schema.auditLogs.params,
    }).from(schema.auditLogs);
    const row = rows.find((r) => r.operation === 'TOKEN_REVOKE');
    expect(row).toBeDefined();
    expect(row!.url).toBe(`https://sso.example.com/api/clients/${CLIENT_ID}/tokens`);
    expect(row!.url).not.toContain('0.0.0.0');
  });
});
