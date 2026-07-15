/**
 * 当前用户 API 集成测试（真实 DB）
 *
 * 覆盖范围：
 * - GET /api/me 返回用户信息、权限、角色及动态菜单树
 * - GET /api/me/permissions 返回权限列表
 * - GET /api/me 无有效身份返回 401
 *
 * @req B-USR-R, H-AUTH-001
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createTestRequest } from '../helpers/test-utils';
import {
  createTestDbHandle,
  seedTestData,
} from '../helpers/test-db';
import {
  seedRootDept,
  seedAdminUser,
  seedSuperAdminRole,
  seedTestPermission,
  seedUserRoleBinding,
} from '../helpers/seed-fixtures';

const now = new Date();

// ── 可切换的 resolveIdentity 模拟 ─────────────────────
const { mockResolveIdentity } = vi.hoisted(() => ({
  mockResolveIdentity: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  resolveIdentity: mockResolveIdentity,
  logServerDataRead: vi.fn(async () => {}),
}));

vi.mock('@/lib/menu-tree', () => ({
  getDynamicMenuTree: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/infrastructure/redis', () => ({
  getRedis: vi.fn(() => null),
}));

// ── 真实 DB：TDZ 回避策略 ─────────────────────────────
// /api/me/route.ts → data.ts → user-queries.ts 在模块顶层访问 schema.users.id，
// 若使用静态 import 会在 td 初始化前触发 getter。改用动态 import 确保 td 就绪后
// 再加载路由模块。
const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));

type RouteHandler = (req: any) => Promise<Response>;
let GetMe: RouteHandler;
let GetMePermissions: RouteHandler;

beforeAll(async () => {
  await td.connect();
  // 此时 td 已就绪，动态导入路由模块即可安全访问 DB 模块
  ({ GET: GetMe } = await import('@/app/api/me/route'));
  ({ GET: GetMePermissions } = await import('@/app/api/me/permissions/route'));
});

afterAll(async () => { await td.close(); });

const USER_ID = '00000000-0000-4000-8000-000000000101';
const DEPT_ID = '00000000-0000-4000-8000-000000000001';
const ROLE_ID = '00000000-0000-4000-8000-000000000301';
const PERM_ID_USER_LIST = '00000000-0000-4000-8000-000000000401';
const PERM_ID_USER_CREATE = '00000000-0000-4000-8000-000000000402';
const PERM_ID_USER_UPDATE = '00000000-0000-4000-8000-000000000403';
const PERM_ID_USER_DELETE = '00000000-0000-4000-8000-000000000404';

const defaultIdentity = {
  userId: USER_ID,
  claims: {
    sub: USER_ID,
    email: 'admin@example.com',
    name: '超级管理员',
    jti: 'jti-123',
    iss: 'http://localhost:4101',
    aud: 'http://localhost:4101',
    exp: 9999999999,
    iat: 1000000000,
    roles: ['SUPER_ADMIN'],
    permissions: ['user:list', 'user:create', 'user:update', 'user:delete'],
    deptIds: [DEPT_ID],
  },
};

beforeEach(async () => {
  vi.clearAllMocks();
  mockResolveIdentity.mockResolvedValue(defaultIdentity);
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedAdminUser(),
    roles: seedSuperAdminRole(),
    permissions: [
      seedTestPermission({ id: PERM_ID_USER_LIST, code: 'user:list', name: '用户列表', resource: '/api/users', action: 'list' }),
      seedTestPermission({ id: PERM_ID_USER_CREATE, code: 'user:create', name: '创建用户', resource: '/api/users', action: 'create' }),
      seedTestPermission({ id: PERM_ID_USER_UPDATE, code: 'user:update', name: '更新用户', resource: '/api/users', action: 'update' }),
      seedTestPermission({ id: PERM_ID_USER_DELETE, code: 'user:delete', name: '删除用户', resource: '/api/users', action: 'delete' }),
    ].flat(),
    userRoles: seedUserRoleBinding(USER_ID, ROLE_ID),
    rolePermissions: [
      { roleId: ROLE_ID, permissionId: PERM_ID_USER_LIST, createdAt: now },
      { roleId: ROLE_ID, permissionId: PERM_ID_USER_CREATE, createdAt: now },
      { roleId: ROLE_ID, permissionId: PERM_ID_USER_UPDATE, createdAt: now },
      { roleId: ROLE_ID, permissionId: PERM_ID_USER_DELETE, createdAt: now },
    ],
  });
});

describe('Me Endpoints', () => {
  // ======== GET /api/me ========

  describe('GET /api/me', () => {
    it('返回用户信息（含身份验证通过）', async () => {
      const response = await GetMe(createTestRequest('/api/me'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.user).toBeDefined();
      expect(body.user.email).toBe('admin@example.com');
      expect(body.tokenInfo).toBeDefined();
      expect(body.permissions).toBeDefined();
      expect(body.permissions).toContain('user:list');
      expect(body.roles).toBeDefined();
      expect(body.roles).toContain('SUPER_ADMIN');
      expect(body.menus).toBeDefined();
    });

    it('无身份时返回 401', async () => {
      mockResolveIdentity.mockResolvedValue(null);

      const response = await GetMe(createTestRequest('/api/me'));
      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.error).toBeDefined();
    });

    it('返回 tokenInfo.expiresAt 用于前端静默刷新调度', async () => {
      mockResolveIdentity.mockResolvedValue({
        ...defaultIdentity,
        claims: { ...defaultIdentity.claims, exp: 2000000000 },
      });

      const response = await GetMe(createTestRequest('/api/me'));
      const body = await response.json();

      expect(body.tokenInfo.expiresAt).toBe(2000000000 * 1000);
    });
  });

  // ======== GET /api/me/permissions ========

  describe('GET /api/me/permissions', () => {
    it('返回用户权限上下文', async () => {
      const response = await GetMePermissions(createTestRequest('/api/me/permissions'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.userId).toBe(USER_ID);
      expect(body.permissions).toContain('user:list');
      expect(body.permissions).toContain('user:create');
      expect(body.roles).toBeDefined();
      expect(body.roles).toHaveLength(1);
      expect(body.roles[0].code).toBe('SUPER_ADMIN');
      expect(body.deptIds).toContain(DEPT_ID);
    });

    it('无身份时返回 401', async () => {
      mockResolveIdentity.mockResolvedValue(null);

      const response = await GetMePermissions(createTestRequest('/api/me/permissions'));
      expect(response.status).toBe(401);
    });

    it('用户不存在时返回 500', async () => {
      mockResolveIdentity.mockResolvedValue({
        userId: '00000000-0000-4000-8000-000000000999',
        claims: { ...defaultIdentity.claims, sub: '00000000-0000-4000-8000-000000000999' },
      });

      const response = await GetMePermissions(createTestRequest('/api/me/permissions'));
      expect(response.status).toBe(500);
    });
  });
});
