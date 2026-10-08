/**
 * 部门管理 API 集成测试（真实 DB）
 *
 * 覆盖范围：
 * - GET /api/departments 树形结构（含子部门嵌套）
 * - POST 创建部门 (createDepartmentAction)
 * - POST 创建子部门（ancestors 计算）
 * - 循环引用防护（更新 parentId 为自身）
 *
 * @req F-DEP-L, F-DEP-C, F-DEP-U, H-DSCOPE-001~003
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedAdminUser, seedSuperAdminRole, seedUserRoleBinding } from '../helpers/seed-fixtures';
import { createTestRequest, parseResponseJson } from '../helpers/test-utils';
import * as schema from '@/db/schema';
import { BusinessRuleViolationError } from '@/domain/shared/errors';

// ── 测试数据库 ──────────────────────────────────────
const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));

// ── 常量 ID ────────────────────────────────────────
const ROOT_DEPT_ID = '00000000-0000-4000-8000-000000000001';
const TECH_DEPT_ID = '00000000-0000-4000-8000-000000000002';
const FE_DEPT_ID = '00000000-0000-4000-8000-000000000003';
const MKT_DEPT_ID = '00000000-0000-4000-8000-000000000004';
const ADMIN_USER_ID = '00000000-0000-4000-8000-000000000101';
const CREATED_DEPT_ID = 'aabbccdd-eeff-4000-8000-000000000001';

const now = new Date();

// ── Auth mock（同时覆盖 withPermission 和 withAuth）─
const { mockWithPermission, mockGetUserRoleDeptIds } = vi.hoisted(() => {
  const mockWithPermission = vi.fn(
    async (_options: any, handler: Function) =>
      handler('00000000-0000-4000-8000-000000000101'),
  );
  const mockGetUserRoleDeptIds = vi.fn().mockResolvedValue([]);
  return { mockWithPermission, mockGetUserRoleDeptIds };
});

vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({
    userId: '00000000-0000-4000-8000-000000000101',
  })),
  logServerDataRead: vi.fn(async () => {}),
  getUserRoleDeptIds: mockGetUserRoleDeptIds,
  canAccessDept: vi.fn(() => true),
  requireDeptAccess: vi.fn(async () => {}),
  withPermission: mockWithPermission,
  withAuth:
    (_o: any, h: Function) =>
    async (...a: any[]) =>
      h(
        {
          userId: '00000000-0000-4000-8000-000000000101',
        },
        ...a,
      ),
}));

vi.mock('@/lib/crypto', () => ({
  generateUUID: () => CREATED_DEPT_ID,
  generateId: (_len?: number) => 'aaaaaaaa',
  hashToken: (t: string) => t,
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

// ── 被测试模块（动态导入避免模块解析时触发 @/infrastructure/db mock）───
let ListDepartments: any;
let createDepartmentAction: any;
let updateDepartmentAction: any;

// ── 生命周期 ───────────────────────────────────────
beforeAll(async () => {
  await td.connect();
  const routeMod = await import('@/app/api/departments/route');
  ListDepartments = routeMod.GET;
  const actionsMod = await import('@/app/(dashboard)/departments/actions');
  createDepartmentAction = actionsMod.createDepartmentAction;
  updateDepartmentAction = actionsMod.updateDepartmentAction;
});
afterAll(async () => {
  await td.close();
});
beforeEach(async () => {
  vi.clearAllMocks();
  await td.cleanup();
});

// ── 种子工具 ───────────────────────────────────────

/**
 * 播种部门树 + 一个真实的管理员角色绑定。
 *
 * 读路径的数据范围现在由真实的 `resolveScope`（lib/authz）解析，
 * 走原生 SQL 读 `user_roles → roles.dept_id`，不再经过被 mock 的
 * `@/lib/auth`。因此操作者必须在库中真实拥有一个根部门角色，否则
 * 其可见范围为空、读模型 fail-closed 返回空集。
 */
/**
 * 为"自行内联播种部门"的用例补上操作者角色。
 *
 * 写路径的数据范围守卫现由真实 `resolveScope`（lib/authz）解析，走原生 SQL 读
 * `user_roles → roles.dept_id`，不再经过被 mock 的 `@/lib/auth`。操作者若在库中
 * 没有真实角色，可见范围为空、守卫会正确拒绝。
 */
async function seedOperatorScope() {
  await seedTestData(td.db, {
    users: seedAdminUser(),
    roles: seedSuperAdminRole({ deptId: ROOT_DEPT_ID }),
    userRoles: seedUserRoleBinding(ADMIN_USER_ID, '00000000-0000-4000-8000-000000000301'),
  });
}

async function seedTreeWithAdminScope(
  departments: ReturnType<typeof seedThreeLevelTree>,
  roleDeptId: string = ROOT_DEPT_ID,
) {
  await seedTestData(td.db, {
    departments,
    users: seedAdminUser(),
    // 角色的 dept_id 决定操作者范围（含子树展开）
    roles: seedSuperAdminRole({ deptId: roleDeptId }),
    userRoles: seedUserRoleBinding(ADMIN_USER_ID, '00000000-0000-4000-8000-000000000301'),
  });
}
function seedThreeLevelTree() {
  return [
    {
      id: ROOT_DEPT_ID,
      parentId: null,
      name: '总公司',
      code: 'ROOT',
      ancestors: null,
      sort: 0,
      status: 'ACTIVE' as const,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: TECH_DEPT_ID,
      parentId: ROOT_DEPT_ID,
      name: '技术部',
      code: 'TECH',
      ancestors: ROOT_DEPT_ID,
      sort: 1,
      status: 'ACTIVE' as const,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: FE_DEPT_ID,
      parentId: TECH_DEPT_ID,
      name: '前端组',
      code: 'FE',
      ancestors: `${ROOT_DEPT_ID}/${TECH_DEPT_ID}`,
      sort: 0,
      status: 'ACTIVE' as const,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: MKT_DEPT_ID,
      parentId: ROOT_DEPT_ID,
      name: '市场部',
      code: 'MKT',
      ancestors: ROOT_DEPT_ID,
      sort: 2,
      status: 'ACTIVE' as const,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

// ========================================================================
// Tests
// ========================================================================

describe('Department API', () => {
  // ── GET /api/departments ─────────────────────────────────
  describe('GET /api/departments', () => {
    it('返回多级嵌套树形结构', async () => {
      await seedTreeWithAdminScope(seedThreeLevelTree(), ROOT_DEPT_ID);

      const req = createTestRequest('/api/departments');
      const res = await ListDepartments(req);
      const body = await parseResponseJson(res);

      expect(res.status).toBe(200);
      // 全范围：根部门角色的子树 = ROOT + 一级子部门(TECH/MKT) + 更深层(FE)
      expect(body).toHaveLength(1);
      const root = body[0];
      expect(root.id).toBe(ROOT_DEPT_ID);
      expect(root.children).toHaveLength(2);

      const techDept = root.children.find((c: any) => c.id === TECH_DEPT_ID);
      expect(techDept).toBeDefined();
      expect(techDept.name).toBe('技术部');
      expect(techDept.children).toHaveLength(1);
      expect(techDept.children[0].id).toBe(FE_DEPT_ID);
      expect(techDept.children[0].name).toBe('前端组');
    });

    it('deptIds 为空时返回空数组', async () => {
      await seedTestData(td.db, { departments: seedThreeLevelTree() });

      vi.mocked(mockWithPermission).mockImplementationOnce(
        async (_o, handler) =>
          handler(ADMIN_USER_ID, { sub: '', iss: '', aud: 'auth-sso', jti: '' }),
      );

      const req = createTestRequest('/api/departments');
      const res = await ListDepartments(req);
      const body = await parseResponseJson(res);

      expect(res.status).toBe(200);
      expect(body).toEqual([]);
    });

    it('deptIds 限定时只返回可访问的子树', async () => {
      // 只给技术部角色 → 可见范围 = 技术部子树 {TECH, FE}，不应看到 MKT
      await seedTreeWithAdminScope(seedThreeLevelTree(), TECH_DEPT_ID);

      const req = createTestRequest('/api/departments');
      const res = await ListDepartments(req);
      const body = await parseResponseJson(res);

      expect(res.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe(TECH_DEPT_ID);
    });
  });

  // ── POST 创建部门 ──────────────────────────────────────
  describe('POST create department', () => {
    it('创建顶级部门 — ancestors 为 null', async () => {
      await seedTestData(td.db, {
        departments: [
          {
            id: ROOT_DEPT_ID,
            parentId: null,
            name: '总公司',
            code: 'ROOT',
            ancestors: null,
            sort: 0,
            status: 'ACTIVE' as const,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });

      const r: any = await createDepartmentAction({
        name: '新事业部',
        code: 'BU',
        sort: 1,
        parentId: null,
      });

      expect(r.success).toBe(true);
      expect(r.data.id).toBe(CREATED_DEPT_ID);
      expect(r.message).toBe('部门创建成功');

      const rows = await td.db.select().from(schema.departments);
      const created = rows.find((d) => d.name === '新事业部');
      expect(created).toBeDefined();
      expect(created!.code).toBe('BU');
      expect(created!.parentId).toBeNull();
      expect(created!.ancestors).toBeNull();
    });

    it('创建子部门 — ancestors 正确级联', async () => {
      await seedTestData(td.db, {
        departments: [
          {
            id: ROOT_DEPT_ID,
            parentId: null,
            name: '总公司',
            code: 'ROOT',
            ancestors: null,
            sort: 0,
            status: 'ACTIVE' as const,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
      await seedOperatorScope();

      const r: any = await createDepartmentAction({
        name: '财务部',
        code: 'FIN',
        sort: 3,
        parentId: ROOT_DEPT_ID,
      });

      expect(r.success).toBe(true);

      const rows = await td.db.select().from(schema.departments);
      const child = rows.find((d) => d.name === '财务部');
      expect(child).toBeDefined();
      expect(child!.parentId).toBe(ROOT_DEPT_ID);
      expect(child!.ancestors).toBe(ROOT_DEPT_ID);
    });

    it('创建二级子部门 — ancestors 多级路径', async () => {
      await seedTestData(td.db, {
        departments: [
          {
            id: ROOT_DEPT_ID,
            parentId: null,
            name: '总公司',
            code: 'ROOT',
            ancestors: null,
            sort: 0,
            status: 'ACTIVE' as const,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: TECH_DEPT_ID,
            parentId: ROOT_DEPT_ID,
            name: '技术部',
            code: 'TECH',
            ancestors: ROOT_DEPT_ID,
            sort: 1,
            status: 'ACTIVE' as const,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
      await seedOperatorScope();

      const r: any = await createDepartmentAction({
        name: '后端组',
        code: 'BE',
        sort: 0,
        parentId: TECH_DEPT_ID,
      });

      expect(r.success).toBe(true);

      const rows = await td.db.select().from(schema.departments);
      const sub = rows.find((d) => d.name === '后端组');
      expect(sub).toBeDefined();
      expect(sub!.parentId).toBe(TECH_DEPT_ID);
      expect(sub!.ancestors).toBe(`${ROOT_DEPT_ID}/${TECH_DEPT_ID}`);
    });

    it('缺必填字段 → success: false 含错误信息', async () => {
      const r: any = await createDepartmentAction({
        name: '',
        code: '',
        sort: 1,
        parentId: null,
      } as any);

      expect(r.success).toBe(false);
      expect(r.error).toBeDefined();
      expect(r.message).toBeDefined();
    });
  });

  // ── 循环引用防护 ──────────────────────────────────────
  describe('circular reference prevention', () => {
    it('更新为自身 parentId → BusinessRuleViolationError', async () => {
      await seedTestData(td.db, {
        departments: [
          {
            id: ROOT_DEPT_ID,
            parentId: null,
            name: '总公司',
            code: 'ROOT',
            ancestors: null,
            sort: 0,
            status: 'ACTIVE' as const,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: TECH_DEPT_ID,
            parentId: ROOT_DEPT_ID,
            name: '技术部',
            code: 'TECH',
            ancestors: ROOT_DEPT_ID,
            sort: 1,
            status: 'ACTIVE' as const,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
      await seedOperatorScope();

      await expect(
        updateDepartmentAction(TECH_DEPT_ID, { parentId: TECH_DEPT_ID } as any),
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('更新 parentId 为自身子部门 → BusinessRuleViolationError', async () => {
      await seedTestData(td.db, { departments: seedThreeLevelTree() });
      await seedOperatorScope();

      await expect(
        updateDepartmentAction(TECH_DEPT_ID, { parentId: FE_DEPT_ID } as any),
      ).rejects.toThrow(BusinessRuleViolationError);
    });

    it('更新 parentId 为自身孙子部门 → BusinessRuleViolationError', async () => {
      await seedTestData(td.db, {
        departments: [
          {
            id: ROOT_DEPT_ID,
            parentId: null,
            name: '总公司',
            code: 'ROOT',
            ancestors: null,
            sort: 0,
            status: 'ACTIVE' as const,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: TECH_DEPT_ID,
            parentId: ROOT_DEPT_ID,
            name: '技术部',
            code: 'TECH',
            ancestors: ROOT_DEPT_ID,
            sort: 1,
            status: 'ACTIVE' as const,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: FE_DEPT_ID,
            parentId: TECH_DEPT_ID,
            name: '前端组',
            code: 'FE',
            ancestors: `${ROOT_DEPT_ID}/${TECH_DEPT_ID}`,
            sort: 0,
            status: 'ACTIVE' as const,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: '00000000-0000-4000-8000-000000000005',
            parentId: FE_DEPT_ID,
            name: 'H5组',
            code: 'H5',
            ancestors: `${ROOT_DEPT_ID}/${TECH_DEPT_ID}/${FE_DEPT_ID}`,
            sort: 0,
            status: 'ACTIVE' as const,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
      await seedOperatorScope();

      await expect(
        updateDepartmentAction(TECH_DEPT_ID, {
          parentId: '00000000-0000-4000-8000-000000000005',
        } as any),
      ).rejects.toThrow(BusinessRuleViolationError);
    });
  });
});
